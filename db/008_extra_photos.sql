-- Up to 9 extra photos per memory, on top of the cover photo_url (10 total).
alter table photo_cards
  add column if not exists extra_photos jsonb not null default '[]'::jsonb;

alter table photo_cards drop constraint if exists photo_cards_extra_photos_max;
alter table photo_cards
  add constraint photo_cards_extra_photos_max
  check (jsonb_typeof(extra_photos) = 'array' and jsonb_array_length(extra_photos) <= 9);
