import { describe, expect, it } from 'vitest';
import { catalogPrice } from './catalog.js';

describe('catalogPrice', () => {
  it('reads features and entitlements from product metadata', () => {
    const price = catalogPrice({
      id: 'price_plus',
      unit_amount: 900,
      currency: 'USD',
      recurring: { interval: 'month' },
      product: {
        name: 'Plus',
        metadata: {
          features: '["Saved locations","Alerts"]',
          entitlements: '{"maxSavedLocations":10,"maxFollows":200}',
        },
      },
    });
    expect(price).toEqual({
      stripePriceId: 'price_plus',
      name: 'Plus',
      amountCents: 900,
      currency: 'usd',
      interval: 'month',
      features: ['Saved locations', 'Alerts'],
      entitlements: { maxSavedLocations: 10, maxFollows: 200 },
    });
  });

  it('skips a deleted product so the local plan can be deactivated', () => {
    expect(
      catalogPrice({
        id: 'price_old',
        unit_amount: 100,
        currency: 'usd',
        recurring: { interval: 'year' },
        product: { deleted: true },
      }),
    ).toBeNull();
  });
});
