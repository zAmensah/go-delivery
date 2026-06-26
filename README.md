# go-delivery-pricing

Framework-agnostic TypeScript SDK for ecommerce checkout delivery pricing.

The package searches checkout delivery locations with Google Maps, gathers delivery prices from Bolt, Yango, Uber, and an internal calculator, then returns the highest available price multiplied by the configured markup multiplier. The default multiplier is `1.5`.

This is an ESM-only server-side package for Node.js `>=20`.

## Install

```sh
npm install go-delivery-pricing
```

## Basic Usage

```ts
import {
  createDeliveryPricingClient,
  createMockProviderAdapter
} from "go-delivery-pricing";

const delivery = createDeliveryPricingClient({
  pickupLocation: {
    address: "Main warehouse",
    coordinates: { lat: 5.6037, lng: -0.187 }
  },
  currency: "GHS",
  fallbackPrice: 60,
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY!,
  markupMultiplier: 1.5,
  providers: {
    bolt: createMockProviderAdapter({ source: "bolt", amount: 35 }),
    yango: createMockProviderAdapter({ source: "yango", amount: 42 }),
    uber: createMockProviderAdapter({ source: "uber", amount: 39 })
  },
  internalDelivery: {
    baseFee: 12,
    perKmFee: 4,
    minimumFee: 20,
    maximumFee: 90,
    distanceBands: [
      { upToKm: 3, fee: 10 },
      { upToKm: 8, fee: 25 }
    ]
  }
});

const matches = await delivery.searchLocations("East Legon");
const selectedLocation = await delivery.resolveLocation(matches[0].placeId);
const price = await delivery.getDeliveryPrice(selectedLocation);

console.log(price.finalAmount, price.currency);
```

Amounts use decimal currency units. For example, `25.5` means `GHS 25.50`. The returned `finalAmount` is rounded up to the next whole currency amount after markup, so `75.23` becomes `76`.

## Next.js Setup

Use this package in server-side Next.js code, such as an App Router route handler. Keep the Google Maps API key and provider credentials in environment variables so they are not exposed to the browser.

```ts
// app/api/delivery-price/route.ts
import {
  createDeliveryPricingClient,
  createMockProviderAdapter
} from "go-delivery-pricing";

export async function POST(request: Request) {
  const { destination } = await request.json();

  const delivery = createDeliveryPricingClient({
    pickupLocation: {
      address: "Main warehouse",
      coordinates: { lat: 5.6037, lng: -0.187 }
    },
    currency: "GHS",
    fallbackPrice: 60,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY!,
    markupMultiplier: 1.5,
    providers: {
      bolt: createMockProviderAdapter({ source: "bolt", amount: 35 }),
      yango: createMockProviderAdapter({ source: "yango", amount: 42 }),
      uber: createMockProviderAdapter({ source: "uber", amount: 39 })
    },
    internalDelivery: {
      baseFee: 12,
      perKmFee: 4,
      minimumFee: 20,
      maximumFee: 90
    }
  });

  const price = await delivery.getDeliveryPrice(destination);

  return Response.json(price);
}
```

Your checkout UI can call the route from a client component.

```tsx
"use client";

import { useState } from "react";

export function CheckoutDeliveryPrice() {
  const [deliveryPrice, setDeliveryPrice] = useState<number | null>(null);

  async function loadDeliveryPrice() {
    const response = await fetch("/api/delivery-price", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        destination: {
          address: "Customer address",
          coordinates: { lat: 5.62, lng: -0.19 }
        }
      })
    });

    const price = await response.json();
    setDeliveryPrice(price.finalAmount);
  }

  return (
    <button type="button" onClick={loadDeliveryPrice}>
      {deliveryPrice ? `Delivery: GHS ${deliveryPrice}` : "Get delivery price"}
    </button>
  );
}
```

## React Setup

For a browser-only React app, use this package from your backend, not directly inside React components. The backend can be Express, NestJS, Laravel API, Next.js API routes, or any server that can import the package and keep secrets private.

```ts
// React helper used by your checkout page
export async function fetchDeliveryPrice(destination: {
  address?: string;
  placeId?: string;
  coordinates?: { lat: number; lng: number };
}) {
  const response = await fetch("/api/delivery-price", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ destination })
  });

  if (!response.ok) {
    throw new Error("Could not load delivery price.");
  }

  return response.json();
}
```

```tsx
import { useState } from "react";
import { fetchDeliveryPrice } from "./delivery";

export function DeliveryButton() {
  const [price, setPrice] = useState<{ finalAmount: number; currency: string } | null>(null);

  async function handleClick() {
    const nextPrice = await fetchDeliveryPrice({
      address: "Customer address",
      coordinates: { lat: 5.62, lng: -0.19 }
    });

    setPrice(nextPrice);
  }

  return (
    <button type="button" onClick={handleClick}>
      {price ? `${price.currency} ${price.finalAmount}` : "Calculate delivery"}
    </button>
  );
}
```

Do not import or call `createDeliveryPricingClient` directly inside browser-only React components. That can expose Google Maps keys, Bolt/Yango/Uber credentials, and internal pricing rules in the client bundle.

## Checkout Flow

1. Call `searchLocations(query)` while the customer types their delivery address.
2. Call `resolveLocation(placeId)` when they select a Google Maps result.
3. Call `getDeliveryPrice(destination)` before order confirmation.

`getDeliveryPrice` returns all source quote results, the selected base amount, the applied markup, the final amount, and warnings.

## Provider Adapters

Bolt, Yango, and Uber delivery pricing access can vary by account and market, so the SDK accepts adapters instead of hard-coding provider credentials or private endpoint assumptions.

```ts
const boltAdapter = {
  async getQuote(request) {
    // Call your Bolt integration here.
    return {
      source: "bolt",
      amount: 35,
      currency: request.currency
    };
  }
};
```

Each adapter receives the configured pickup location, resolved destination, and configured currency.

Adapter `amount` values should use decimal currency units. For example, return `25.5` for `GHS 25.50`.

## Fallback Behavior

The SDK treats Bolt, Yango, Uber, and the internal calculator as four pricing sources.

- If all four sources return valid quotes in the configured currency, the SDK selects the highest amount.
- If fewer than four sources succeed, the SDK uses `fallbackPrice`.
- The returned `finalAmount` is `baseAmount * markupMultiplier`, rounded up to the next whole currency amount.

## Internal Delivery Rules

The internal calculator uses Google Maps distance data between pickup and destination.

- `baseFee` is always included.
- `distanceBands` can override the per-kilometer calculation for matching distances.
- If no band matches, the calculator uses `baseFee + distanceKm * perKmFee`.
- `minimumFee` and `maximumFee` are applied after the calculation.

## Scripts

```sh
npm run clean
npm run build
npm run typecheck
npm test
```

## Publishing

Before publishing, replace the placeholder `repository`, `bugs`, and `homepage` URLs in `package.json` with the real GitHub repository.

```sh
npm run build
npm run typecheck
npm test
npm --cache /private/tmp/go-delivery-npm-cache pack --dry-run
npm login
npm publish
```
