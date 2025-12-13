/**
 * Example 8: Real-World Workflow - E-commerce Checkout
 *
 * Demonstrates:
 * - Sequential dependencies (each step requires previous success)
 * - Compensation logic (rollback inventory on payment failure)
 * - Error categorization (retryable vs permanent)
 * - Partial rollback patterns
 * - matchExhaustive() for user-friendly messages
 * - tap()/tapErr() for audit logging
 *
 * Run: deno run examples/08-real-world-workflow.ts
 */

import { AsyncBox, defineErrors, type ErrorsOf, t } from "../mod.ts";

// Define checkout errors
const CheckoutErrors = defineErrors({
  InvalidCart: { reason: t.string },
  OutOfStock: { productId: t.string, requested: t.number, available: t.number },
  PaymentDeclined: { reason: t.string, code: t.string },
  PaymentProcessorError: {
    processor: t.string,
    transactionId: t.optional<string>(),
  },
  InventoryLockFailed: { productId: t.string },
  OrderCreationFailed: { reason: t.string },
  NotificationFailed: { channel: t.string, recoverable: t.boolean },
});

type CheckoutError = ErrorsOf<typeof CheckoutErrors>;

// Domain types
interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

interface Cart {
  items: CartItem[];
  total: number;
}

interface PaymentMethod {
  type: "credit_card" | "paypal";
  last4?: string;
}

interface PaymentResult {
  transactionId: string;
  amount: number;
  status: "completed";
}

interface Order {
  orderId: string;
  cart: Cart;
  payment: PaymentResult;
  timestamp: number;
}

interface InventoryReservation {
  reservationId: string;
  items: CartItem[];
  expiresAt: number;
}

// Mock services
class InventoryService {
  private stock = new Map<string, number>([
    ["prod-1", 10],
    ["prod-2", 5],
    ["prod-3", 0], // Out of stock
    ["prod-4", 100],
  ]);

  private reservations = new Map<string, InventoryReservation>();

  checkAvailability(
    items: CartItem[],
  ): { available: boolean; unavailable?: CartItem } {
    for (const item of items) {
      const available = this.stock.get(item.productId) || 0;
      if (available < item.quantity) {
        return { available: false, unavailable: item };
      }
    }
    return { available: true };
  }

  reserve(items: CartItem[]): InventoryReservation {
    const reservationId = `RSV-${Date.now()}`;
    const reservation: InventoryReservation = {
      reservationId,
      items,
      expiresAt: Date.now() + 300000, // 5 minutes
    };

    // Deduct from stock
    for (const item of items) {
      const current = this.stock.get(item.productId) || 0;
      this.stock.set(item.productId, current - item.quantity);
    }

    this.reservations.set(reservationId, reservation);
    return reservation;
  }

  release(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return;

    // Return to stock
    for (const item of reservation.items) {
      const current = this.stock.get(item.productId) || 0;
      this.stock.set(item.productId, current + item.quantity);
    }

    this.reservations.delete(reservationId);
  }
}

class PaymentService {
  private failureRate = 0.2;

  process(amount: number, _method: PaymentMethod): PaymentResult {
    if (Math.random() < this.failureRate) {
      throw new Error("Payment declined: insufficient_funds");
    }

    return {
      transactionId: `PAY-${Date.now()}`,
      amount,
      status: "completed",
    };
  }
}

class OrderService {
  private orders = new Map<string, Order>();

  create(cart: Cart, payment: PaymentResult): Order {
    const order: Order = {
      orderId: `ORD-${Date.now()}`,
      cart,
      payment,
      timestamp: Date.now(),
    };

    this.orders.set(order.orderId, order);
    return order;
  }

  get(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }
}

const inventory = new InventoryService();
const payments = new PaymentService();
const orders = new OrderService();

// Helper: Async delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Validate cart
function validateCart(
  cart: Cart,
): AsyncBox<Cart, ReturnType<typeof CheckoutErrors.InvalidCart>> {
  if (cart.items.length === 0) {
    return AsyncBox.err(CheckoutErrors.InvalidCart({
      reason: "Cart is empty",
    }));
  }

  const calculatedTotal = cart.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  if (Math.abs(calculatedTotal - cart.total) > 0.01) {
    return AsyncBox.err(CheckoutErrors.InvalidCart({
      reason: `Total mismatch: expected ${calculatedTotal}, got ${cart.total}`,
    }));
  }

  return AsyncBox.ok(cart);
}

// 2. Check inventory availability
function checkInventory(
  items: CartItem[],
): AsyncBox<CartItem[], ReturnType<typeof CheckoutErrors.OutOfStock>> {
  return AsyncBox.wrap<
    CartItem[],
    ReturnType<typeof CheckoutErrors.OutOfStock>
  >({
    try: async () => {
      await delay(50);
      const check = inventory.checkAvailability(items);

      if (!check.available && check.unavailable) {
        const item = check.unavailable;
        const available = inventory["stock"].get(item.productId) || 0;
        throw {
          productId: item.productId,
          requested: item.quantity,
          available,
        };
      }

      return items;
    },
    catch: (e: unknown) =>
      CheckoutErrors.OutOfStock(
        e as { productId: string; requested: number; available: number },
      ),
  });
}

// 3. Reserve inventory
function reserveInventory(
  items: CartItem[],
): AsyncBox<
  InventoryReservation,
  ReturnType<typeof CheckoutErrors.InventoryLockFailed>
> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(30);
      return inventory.reserve(items);
    },
    catch: () =>
      CheckoutErrors.InventoryLockFailed({
        productId: items[0]?.productId || "unknown",
      }),
  });
}

// 4. Process payment
function processPayment(
  amount: number,
  method: PaymentMethod,
): AsyncBox<
  PaymentResult,
  | ReturnType<typeof CheckoutErrors.PaymentDeclined>
  | ReturnType<typeof CheckoutErrors.PaymentProcessorError>
> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(100);
      return payments.process(amount, method);
    },
    catch: (e) => {
      if (e instanceof Error && e.message.includes("declined")) {
        const code = e.message.split(": ")[1] || "unknown";
        return CheckoutErrors.PaymentDeclined({
          reason: "Insufficient funds",
          code,
        });
      }
      return CheckoutErrors.PaymentProcessorError({
        processor: method.type,
        transactionId: undefined,
      });
    },
  });
}

// 5. Create order
function createOrder(
  cart: Cart,
  payment: PaymentResult,
): AsyncBox<Order, ReturnType<typeof CheckoutErrors.OrderCreationFailed>> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(40);
      return orders.create(cart, payment);
    },
    catch: (e) =>
      CheckoutErrors.OrderCreationFailed({
        reason: e instanceof Error ? e.message : "Unknown error",
      }),
  });
}

// 6. Send confirmation
function sendConfirmation(
  order: Order,
): AsyncBox<void, ReturnType<typeof CheckoutErrors.NotificationFailed>> {
  return AsyncBox.wrap({
    try: async () => {
      await delay(30);
      // Simulate occasional notification failures (non-critical)
      if (Math.random() < 0.1) {
        throw new Error("SMTP service unavailable");
      }
      console.log(`  → Confirmation sent for order ${order.orderId}`);
    },
    catch: () =>
      CheckoutErrors.NotificationFailed({
        channel: "email",
        recoverable: true,
      }),
  });
}

// 7. Release inventory (rollback helper)
function releaseInventory(reservation: InventoryReservation): void {
  console.log(
    `  → Rolling back inventory reservation ${reservation.reservationId}...`,
  );
  inventory.release(reservation.reservationId);
}

// 8. Main checkout orchestration
function processCheckout(
  cart: Cart,
  paymentMethod: PaymentMethod,
): AsyncBox<Order, CheckoutError> {
  let reservation: InventoryReservation | null = null;

  return validateCart(cart)
    .tap(() =>
      console.log(
        `  ✓ Cart validated (${cart.items.length} items, $${
          cart.total.toFixed(2)
        })`,
      )
    )
    .flatMap(() => checkInventory(cart.items))
    .tap(() => console.log("  ✓ Inventory available"))
    .flatMap((items) => reserveInventory(items))
    .tap((res) => {
      reservation = res;
      console.log(`  ✓ Inventory reserved (${res.reservationId})`);
    })
    .flatMap(() => processPayment(cart.total, paymentMethod))
    .tap((payment) =>
      console.log(
        `  ✓ Payment processed ($${
          payment.amount.toFixed(2)
        }, txn: ${payment.transactionId})`,
      )
    )
    .tapErr((e) => {
      // Rollback inventory if payment fails
      if (
        reservation &&
        (e._tag === "PaymentDeclined" || e._tag === "PaymentProcessorError")
      ) {
        releaseInventory(reservation);
        console.log("  ✓ Inventory released (payment failed)");
      }
    })
    .flatMap((payment) => createOrder(cart, payment))
    .tap((order) => console.log(`  ✓ Order created (${order.orderId})`))
    .flatMap((order) =>
      sendConfirmation(order)
        .catchTag("NotificationFailed", (e) => {
          console.log(
            `  ⚠ Notification failed (${e.channel}), but order is complete`,
          );
          return AsyncBox.ok(undefined);
        })
        .map(() => order)
    );
}

// Demo scenarios
async function main() {
  console.log("\n=== Example 8: E-commerce Checkout Workflow ===\n");

  // Scenario 1: Successful checkout
  console.log("📋 Scenario 1: Successful checkout (happy path)");
  const cart1: Cart = {
    items: [
      { productId: "prod-1", name: "Widget", quantity: 2, price: 29.99 },
      { productId: "prod-2", name: "Gadget", quantity: 1, price: 49.99 },
    ],
    total: 109.97,
  };

  const result1 = await processCheckout(cart1, {
    type: "credit_card",
    last4: "4242",
  })
    .match({
      ok: (order) => `✅ CHECKOUT COMPLETE! Order ID: ${order.orderId}`,
      err: (e) => `❌ CHECKOUT FAILED: ${e._tag}`,
    });
  console.log(result1);
  console.log();

  // Scenario 2: Out of stock error
  console.log("📋 Scenario 2: Out of stock error");
  const cart2: Cart = {
    items: [
      {
        productId: "prod-3",
        name: "Unavailable Item",
        quantity: 5,
        price: 19.99,
      },
    ],
    total: 99.95,
  };

  const result2 = await processCheckout(cart2, { type: "credit_card" })
    .matchExhaustive({
      ok: (order) => `✅ Order: ${order.orderId}`,
      InvalidCart: (e) => `❌ Invalid cart: ${e.reason}`,
      OutOfStock: (e) =>
        `❌ Out of stock: ${e.productId} (need ${e.requested}, have ${e.available})`,
      PaymentDeclined: (e) => `❌ Payment declined: ${e.reason} (${e.code})`,
      PaymentProcessorError: (e) =>
        `❌ Payment processor error: ${e.processor}`,
      InventoryLockFailed: (e) => `❌ Inventory lock failed: ${e.productId}`,
      OrderCreationFailed: (e) => `❌ Order creation failed: ${e.reason}`,
      NotificationFailed: (e) =>
        `⚠ Order complete but notification failed (${e.channel})`,
    });
  console.log(result2);
  console.log();

  // Scenario 3: Payment declined with inventory rollback
  console.log("📋 Scenario 3: Payment declined (with rollback)");
  const cart3: Cart = {
    items: [
      { productId: "prod-4", name: "Premium Item", quantity: 1, price: 299.99 },
    ],
    total: 299.99,
  };

  // Try multiple times to hit payment decline
  let paymentAttempts = 0;
  let declined = false;

  while (!declined && paymentAttempts < 5) {
    paymentAttempts++;
    const result = await processCheckout(cart3, { type: "credit_card" })
      .matchExhaustive({
        ok: () => `✅ Payment succeeded on attempt ${paymentAttempts}`,
        InvalidCart: (e) => `❌ ${e.reason}`,
        OutOfStock: (e) => `❌ Out of stock: ${e.productId}`,
        PaymentDeclined: (e) => {
          declined = true;
          return `❌ PAYMENT DECLINED: ${e.reason} (code: ${e.code})`;
        },
        PaymentProcessorError: (e) => `❌ ${e.processor} error`,
        InventoryLockFailed: (e) => `❌ Lock failed: ${e.productId}`,
        OrderCreationFailed: (e) => `❌ ${e.reason}`,
        NotificationFailed: () => `⚠ Notification failed`,
      });

    if (declined || paymentAttempts === 1) {
      console.log(result);
      break;
    }
  }
  console.log();

  // Scenario 4: Complete flow with notification failure (non-critical)
  console.log("📋 Scenario 4: Order succeeds despite notification failure");
  const cart4: Cart = {
    items: [
      { productId: "prod-1", name: "Widget", quantity: 1, price: 29.99 },
    ],
    total: 29.99,
  };

  // Try multiple times to hit notification failure
  for (let i = 0; i < 3; i++) {
    const result = await processCheckout(cart4, { type: "paypal" })
      .match({
        ok: (order) => `✅ CHECKOUT COMPLETE: ${order.orderId} (with warnings)`,
        err: (e) => {
          if (e._tag === "NotificationFailed") {
            return `⚠ Order complete but notification failed`;
          }
          return `❌ Failed: ${e._tag}`;
        },
      });

    if (result.includes("warnings")) {
      console.log(result);
      break;
    }
  }

  console.log("\n" + "─".repeat(50) + "\n");
}

// Run example
if (import.meta.main) {
  await main();
}
