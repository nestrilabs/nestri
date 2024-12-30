import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";

export module Product {
    export const Variant = z
    .object({
      id: z.string().openapi({
        description: Common.IdDescription,
        example: Examples.ProductVariant.id,
      }),
      name: z.string().openapi({
        description: "Name of the product variant.",
        example: Examples.ProductVariant.name,
      }),
      price: z.number().int().min(0).openapi({
        description: "Price of the product variant in cents (USD).",
        example: Examples.ProductVariant.price,
      }),
    })
    .openapi({
      ref: "ProductVariant",
      description: "Variant of a product in Nestri",
      example: Examples.ProductVariant,
    });
}