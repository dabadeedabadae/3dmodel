-- I-77: what the photo says about an item beyond its type and main colour (pattern, second colour, sleeve, tone),
-- computed on the device when the item is added; used by the recommendations
ALTER TABLE "wardrobe_items" ADD COLUMN "attributes" JSONB;
