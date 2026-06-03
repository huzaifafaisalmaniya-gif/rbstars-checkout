const Stripe = require("stripe");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method Not Allowed" };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Stripe key not configured." }),
    };
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const body = JSON.parse(event.body);

    const cartItems = body.cartItems || body.items;
    const paymentMethod = body.paymentMethod;

    if (!cartItems || cartItems.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "No items provided." }),
      };
    }

    const lineItems = cartItems.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.title,
          images: item.image ? [item.image] : [],
          metadata: {
            shopify_variant_id: String(item.variant_id),
            shopify_product_id: String(item.product_id || ""),
          },
        },
        unit_amount: item.price,
      },
      quantity: item.quantity,
    }));

    const YOUR_DOMAIN = process.env.SHOPIFY_STORE_URL || "https://rbstars.store";

    let payment_method_types = ["card"];
    if (paymentMethod === "paypal") {
      payment_method_types = ["paypal"];
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types,
      line_items: lineItems,
      mode: "payment",
      success_url: `${YOUR_DOMAIN}/pages/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${YOUR_DOMAIN}/cart`,
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "GB", "AU"],
      },
      automatic_tax: { enabled: true },
      metadata: {
        source: "shopify_custom_checkout",
        cart_items_count: String(cartItems.length),
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, sessionId: session.id }),
    };
  } catch (err) {
    console.error("Stripe session error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
