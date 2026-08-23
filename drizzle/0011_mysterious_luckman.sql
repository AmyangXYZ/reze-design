-- Versions are gone: a pin is `{ id }` and resolves to the item as it stands.
--
-- library_item_versions is deliberately NOT dropped here, though the schema no
-- longer declares it. Those rows are the only remaining copy of every payload
-- that was ever published and then edited over, and nothing in the app reads
-- them any more — so keeping them costs half a megabyte and buys the one thing
-- this migration cannot otherwise give back. Dropping the table is a separate,
-- deliberate act once nobody wants the history.
--
--   DROP TABLE "library_item_versions" CASCADE;
--
-- The two columns below have no such argument: `library_items.version` is a
-- counter with nothing to count, and `scene_uses.item_version` recorded which
-- version a scene pinned when a scene could still pin one.
ALTER TABLE "library_items" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "scene_uses" DROP COLUMN "item_version";
