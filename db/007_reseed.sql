-- ---------------------------------------------------------------------------
-- 003 — starter content
--
-- The heart decks are useless empty, so seed a few cards in each category.
-- Everything here is plain, non-personal filler — replace it with your own
-- words, which is the whole point of the app.
--
-- IDEMPOTENCY: the delete runs BEFORE the insert, and matches on the exact
-- seed titles rather than a content substring. An earlier version deleted by
-- content AFTER inserting, which silently removed four of its own rows.
-- ---------------------------------------------------------------------------

delete from category_cards where title in (
  'For the silence', 'For how I spoke', 'A promise, not an apology',
  'The small inventory', 'You let me win', 'Patience with strangers',
  'The short version', 'On ordinary mornings', 'Because you stayed',
  'Open when you cannot sleep', 'Open when you feel like a burden', 'A hug, delivered'
);

insert into category_cards (category, title, content)
values
  -- sorry
  ('sorry', 'For the silence',
   'I let you sit in it for three days and told myself I was giving you space. I wasn''t. I was hiding. If I had spoken on day one, we would have fixed it on day one.'),
  ('sorry', 'For how I spoke',
   'Raising my voice is not how I show I care. I know it looks like the opposite. It never is. I am working on it — not as a favour to you, but because I don''t want to be someone you flinch around.'),
  ('sorry', 'A promise, not an apology',
   'When I see you go quiet, I will ask — not wait for you to come to me. No more making you knock.'),

  -- appreciation
  ('appreciation', 'The small inventory',
   'Nobody else has ever bothered to learn the inventory of me. Two sugars. Which song I hate. That I water the basil even though I think basil is a scam plant.'),
  ('appreciation', 'You let me win',
   'Every single game, every single time. I noticed at about round forty and it has been doing something to me ever since.'),
  ('appreciation', 'Patience with strangers',
   'You were kind to the waiter who got the order wrong. I watched, and thought: this is the person I want beside me at the good table.'),

  -- love
  ('love', 'The short version',
   'I love how you look slightly annoyed just before you smile. It is the most reliable thing in the world.'),
  ('love', 'On ordinary mornings',
   'Nobody writes about loving someone while they are brushing their teeth with toothpaste on their chin. I do. That is the whole thing.'),
  ('love', 'Because you stayed',
   'You could have. That is the entire sentence. You could have, and you stayed, and I have never been more careful with anything in my life.'),

  -- comfort
  ('comfort', 'Open when you cannot sleep',
   'Come here. You don''t have to say anything. I will just stay awake with you until it gets boring and then we will both fall asleep.'),
  ('comfort', 'Open when you feel like a burden',
   'You are not a thing to be managed. You are the person I want next to me at the difficult dinner and the boring Tuesday and the waiting room.'),
  ('comfort', 'A hug, delivered',
   'Consider yourself held for approximately nine seconds. Now consider yourself held for considerably longer, pending my availability.');

-- Drop the placeholder track seeded by 004 so the playlist starts empty.
delete from audio_tracks where title = 'Placeholder — replace me';