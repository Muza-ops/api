require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

// Build Shopify API URL using the store URL from the environment
const SHOPIFY_API_URL = `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2025-01`;
// BackMarket API URL (update if necessary)
const BACKMARKET_API_URL = "https://api.backmarket.com/v1";

// Import new orders from Shopify to BackMarket
async function importOrders() {
  try {
    const response = await axios.get(`${SHOPIFY_API_URL}/orders.json`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
      },
    });

    const orders = response.data.orders;
    for (const order of orders) {
      console.log(`Importing Order ${order.id} to BackMarket`);
      await axios.post(
        `${BACKMARKET_API_URL}/orders`,
        { order },
        { headers: { Authorization: `Bearer ${process.env.BACKMARKET_API_KEY}` } }
      );
    }
  } catch (error) {
    console.error("Error importing orders:", error.response?.data || error.message);
  }
}

// Mark shipped orders in BackMarket
async function syncTrackingNumbers() {
  try {
    // Query orders that have been fulfilled
    const response = await axios.get(
      `${SHOPIFY_API_URL}/orders.json?status=fulfilled`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    const orders = response.data.orders;
    for (const order of orders) {
      console.log(`Updating tracking for Order ${order.id} in BackMarket`);
      // Ensure the order has tracking numbers before updating
      if (order.tracking_numbers && order.tracking_numbers.length > 0) {
        await axios.put(
          `${BACKMARKET_API_URL}/orders/${order.id}`,
          { tracking_number: order.tracking_numbers[0] },
          { headers: { Authorization: `Bearer ${process.env.BACKMARKET_API_KEY}` } }
        );
      }
    }
  } catch (error) {
    console.error("Error syncing tracking numbers:", error.response?.data || error.message);
  }
}

// Sync stock between Shopify and BackMarket
async function syncStock() {
  try {
    const response = await axios.get(`${SHOPIFY_API_URL}/products.json`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
      },
    });

    for (const product of response.data.products) {
      // Ensure the product has at least one variant with a SKU
      if (product.variants && product.variants.length > 0) {
        const variant = product.variants[0];
        if (variant.sku) {
          console.log(`Updating stock for SKU ${variant.sku}`);
          await axios.put(
            `${BACKMARKET_API_URL}/inventory/${variant.sku}`,
            { stock: variant.inventory_quantity },
            { headers: { Authorization: `Bearer ${process.env.BACKMARKET_API_KEY}` } }
          );
        } else {
          console.log(`Product ${product.id} variant does not have a SKU. Skipping.`);
        }
      }
    }
  } catch (error) {
    console.error("Error syncing stock:", error.response?.data || error.message);
  }
}

// Cancel Shopify orders if they were canceled in BackMarket
async function cancelOrders() {
  try {
    const response = await axios.get(
      `${BACKMARKET_API_URL}/orders?status=canceled`,
      {
        headers: {
          Authorization: `Bearer ${process.env.BACKMARKET_API_KEY}`,
        },
      }
    );

    for (const order of response.data.orders) {
      console.log(`Canceling Order ${order.id} in Shopify`);
      await axios.post(
        `${SHOPIFY_API_URL}/orders/${order.id}/cancel.json`,
        {},
        {
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
          },
        }
      );
    }
  } catch (error) {
    console.error("Error canceling orders:", error.response?.data || error.message);
  }
}

// Schedule tasks every 5 minutes using cron
cron.schedule("*/5 * * * *", importOrders);
cron.schedule("*/5 * * * *", syncTrackingNumbers);
cron.schedule("*/5 * * * *", syncStock);
cron.schedule("*/5 * * * *", cancelOrders);

// Start the Express server on the specified port
const PORT = process.env.PORT || 7001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
