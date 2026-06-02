const Stripe = require("stripe");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers["stripe-signature"];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;

    try {
      // Retrieve full session with line items
      const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items.data.price.product"],
      });

      await createShopifyOrder(fullSession);

      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    } catch (err) {
      console.error("Failed to create Shopify order:", err);
      return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function createShopifyOrder(session) {
  const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN; // e.g. yourstore.myshopify.com
  const shopifyToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

  const customer = session.customer_details;
  const shipping = session.shipping_details?.address;

  // Build line items from Stripe session
  const line_items = session.line_items.data.map((item) => {
    const variantId = item.price?.product?.metadata?.shopify_variant_id;
    return {
      variant_id: variantId ? parseInt(variantId) : null,
      title: item.description,
      quantity: item.quantity,
      price: (item.amount_total / 100 / item.quantity).toFixed(2),
    };
  });

  const orderPayload = {
    order: {
      email: customer.email,
      financial_status: "paid",
      fulfillment_status: null,
      line_items,
      transactions: [
        {
          kind: "sale",
          status: "success",
          amount: (session.amount_total / 100).toFixed(2),
          gateway: "stripe",
          authorization: session.payment_intent,
        },
      ],
      shipping_address: shipping
        ? {
            first_name: customer.name?.split(" ")[0] || "",
            last_name: customer.name?.split(" ").slice(1).join(" ") || "",
            address1: shipping.line1,
            address2: shipping.line2 || "",
            city: shipping.city,
            province: shipping.state,
            zip: shipping.postal_code,
            country: shipping.country,
          }
        : undefined,
      note: `Stripe Session ID: ${session.id}`,
      tags: "stripe-checkout",
    },
  };

  const response = await fetch(
    `https://${shopifyDomain}/admin/api/2024-01/orders.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": shopifyToken,
      },
      body: JSON.stringify(orderPayload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify order creation failed: ${errorText}`);
  }

  const data = await response.json();
  console.log("✅ Shopify order created:", data.order.id);
  return data.order;
}
