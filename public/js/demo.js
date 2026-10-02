/**
 * Demo dataset — activated only with `?demo=1` in the URL.
 *
 * Lets the whole UI be reviewed before the PHP API and Supabase exist.
 * Placeholder images are locally-generated SVG gradients (no network, no
 * third-party photo service), so the card treatment can still be judged.
 * Real photos come from Supabase Storage via /api/upload.
 */

export function isDemo() {
  return new URLSearchParams(location.search).get('demo') === '1';
}

/** Soft on-brand gradient standing in for a photo. */
function photo(seedA, seedB, seedC) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">` +
    `<defs>` +
    `<radialGradient id="a" cx="30%" cy="25%"><stop offset="0%" stop-color="${seedA}"/>` +
    `<stop offset="100%" stop-color="${seedB}"/></radialGradient>` +
    `<radialGradient id="b" cx="72%" cy="78%"><stop offset="0%" stop-color="${seedC}"/>` +
    `<stop offset="100%" stop-color="${seedB}" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<rect width="1000" height="1000" fill="${seedB}"/>` +
    `<rect width="1000" height="1000" fill="url(#a)"/>` +
    `<rect width="1000" height="1000" fill="url(#b)"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const DEMO_SETTINGS = {
  anchor_date: '2024-02-14',
  site_title: 'Our Little World',
  partner_names: 'You & Me',
};

/**
 * A real, generated WAV tone — same-origin, so the real WebAudio analyser
 * and visualiser actually run in demo mode instead of being stubbed out.
 */
function toneWav(seconds = 4, rate = 8000) {
  const samples = Math.floor(seconds * rate);
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);

  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    // A gentle two-note chime so the visualiser has something to react to.
    const f = t % 2 < 1 ? 523.25 : 659.25;
    const env = Math.min(1, (t % 2) * 6) * Math.min(1, (2 - (t % 2)) * 6);
    view.setUint8(44 + i, 128 + Math.round(Math.sin(2 * Math.PI * f * t) * 90 * env));
  }

  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/**
 * Demo track list — one of each source type, so the per-source degradation is
 * visible without any setup:
 *   file    → full transport + live visualiser (generated tone, real WebAudio)
 *   youtube → in-page embed via the IFrame API, static equaliser instead
 *   spotify → hand-off only
 *
 * The YouTube and Spotify IDs are placeholders — replace them with your own
 * links in the Music tab.
 */
export const DEMO_TRACKS = [
  {
    id: 'demo-file',
    title: 'Generated chime (file)',
    source_type: 'file',
    source: toneWav(),
    storage_path: null,
    origin: 'demo',
  },
  {
    id: 'demo-yt',
    title: 'YouTube demo',
    source_type: 'youtube',
    source: 'jNQXAC9IVRW',
    storage_path: null,
    origin: 'demo',
  },
  {
    id: 'demo-spotify',
    title: 'Spotify demo',
    source_type: 'spotify',
    source: 'track/4cOdK2wGLETKBW3PvgPWqT',
    storage_path: null,
    origin: 'demo',
  },
];

export const DEMO_PHOTOS = [
  {
    id: 'd1',
    photo_url: photo('#FFD1DC', '#F7C6D9', '#F9A8D4'),
    photo_original_url: null,
    title: 'The first snowfall',
    memory_date: '2024-02-14',
    created_at: '2024-02-14T19:00:00Z',
    letter_text:
      "It snowed the night you came back, and I stood at the window for an hour just watching it land on the street.\n\nI didn't want to text you first. I wanted the whole quiet evening to belong to the idea of you before I risked making it real.\n\nWhen you finally knocked, I had already decided I was going to say yes.",
  },
  {
    id: 'd2',
    photo_url: photo('#EDE7FB', '#D9CCF2', '#8B5CF6'),
    photo_original_url: null,
    title: 'Two sugars, no sleep',
    memory_date: '2024-06-08',
    created_at: '2024-06-08T23:12:00Z',
    letter_text:
      'Four in the morning and we were still talking about nothing.\n\nYou spilled coffee on the book you were reading and then spent twenty minutes apologising to the book. I have never loved anyone more than I loved you in that exact moment.',
  },
  {
    id: 'd3',
    photo_url: photo('#FFFDD0', '#FFD9A8', '#F9A8D4'),
    photo_original_url: null,
    title: 'The bad day',
    memory_date: '2024-09-21',
    created_at: '2024-09-21T21:40:00Z',
    letter_text:
      'You were unkind to me today. I am not going to pretend that was nothing, and I am also not going to let it be the loudest thing about us.\n\nCome back to me. I saved us the good part of the day for this.',
  },
  {
    id: 'd4',
    photo_url: photo('#FFF0F3', '#FBCFE8', '#F9A8D4'),
    photo_original_url: null,
    title: 'Your grandmother’s kitchen',
    memory_date: '2024-11-03',
    created_at: '2024-11-03T15:05:00Z',
    letter_text:
      'You taught me to fold dumplings badly and I have never been happier about anything.\n\nI want a hundred more kitchens with you. I want to be the person who knows how you take your tea for the rest of our lives.',
  },
  {
    id: 'd5',
    photo_url: photo('#F9A8D4', '#BE185D', '#9D174D'),
    photo_original_url: null,
    title: 'Anniversary dinner',
    memory_date: '2025-02-14',
    created_at: '2025-02-14T20:30:00Z',
    letter_text:
      'Eleven months of trying. One year of choosing each other on purpose.\n\nI would pick you again in a heartbeat, and I would pick you slower this time, so I could pay attention to every bit of it.',
  },
  {
    id: 'd6',
    photo_url: photo('#EDE7FB', '#F9A8D4', '#FFFDD0'),
    photo_original_url: null,
    title: 'Rain on the window',
    memory_date: '2025-05-17',
    created_at: '2025-05-17T18:22:00Z',
    letter_text:
      'It rained for three days and neither of us wanted to leave the flat.\n\nWe ate everything in the cupboard. You made me laugh so hard I had to put my drink down. That is the whole memory. Nothing else matters.',
  },
  {
    id: 'd7',
    photo_url: photo('#FFFDD0', '#FFD1DC', '#EDE7FB'),
    photo_original_url: null,
    title: 'The letter you wrote',
    memory_date: '2025-08-30',
    created_at: '2025-08-30T09:14:00Z',
    letter_text:
      'I keep your note in my wallet even though it is falling apart.\n\nYou said you were sorry for the ways you were still learning not to hurt me. I have read it so often the fold lines have gone soft. That is how many times I needed it.',
  },
  {
    id: 'd8',
    photo_url: photo('#FBCFE8', '#8B5CF6', '#FFFDD0'),
    photo_original_url: null,
    title: 'Us, right now',
    memory_date: null,
    created_at: '2025-10-02T12:00:00Z',
    letter_text:
      'No occasion. No reason. You across the table arguing about where to go for dinner.\n\nThis is the one I am most afraid of losing, and the one I am least worried about.',
  },
];

export const DEMO_EVENTS = [
  { id: 'e1', event_date: '2024-02-14', title: 'The day we began again', description: 'Snow. A knock. A yes.', icon_type: 'anniversary' },
  { id: 'e2', event_date: '2024-06-08', title: 'First month back together', description: 'Still arguing about napkins. Progress.', icon_type: 'monthsary' },
  { id: 'e3', event_date: '2024-09-21', title: 'The rough patch', description: 'We talked it out eventually. Writing this down so I remember we did.', icon_type: 'sorry' },
  { id: 'e4', event_date: '2024-11-03', title: "Grandmother's kitchen", description: 'Dumplings. Bad folding. Happy afternoon.', icon_type: 'heart' },
  { id: 'e5', event_date: '2025-02-14', title: 'One year', description: 'Eleven months of trying, one year of choosing.', icon_type: 'anniversary' },
  { id: 'e6', event_date: '2025-05-17', title: 'Rainy three days', description: 'Neither of us left the flat.', icon_type: 'date' },
  { id: 'e7', event_date: '2025-08-30', title: 'The note in my wallet', description: 'The fold lines have gone soft.', icon_type: 'love' },
];

/** `love` isn't a valid icon_type — map it to a permitted one. */
export const DEMO_EVENTS_FIXED = DEMO_EVENTS.map((e) =>
  e.icon_type === 'love' ? { ...e, icon_type: 'heart' } : e,
);

export const DEMO_DECKS = {
  sorry: [
    {
      id: 's1',
      category: 'sorry',
      title: 'For the thing I didn’t say',
      content:
        'I let you sit in that silence for three days and told myself I was giving you space. I wasn’t. I was hiding.\n\nIf I had spoken on day one, we would have fixed it on day one. I am sorry I made you carry my silence like it was yours.',
      created_at: '2024-09-22T10:00:00Z',
    },
    {
      id: 's2',
      category: 'sorry',
      title: 'For how I spoke',
      content:
        'Raising my voice is not how I show that I care. I know it looks like the opposite. It never is.\n\nI am working on it — not as a favour to you, but because I don’t want to be someone you flinch around.',
      created_at: '2024-09-22T10:05:00Z',
    },
    {
      id: 's3',
      category: 'sorry',
      title: 'For not listening',
      content:
        'You told me something important and I gave you a paragraph about my week.\n\nI want to be the person who asks the second question. I am practising that.',
      created_at: '2024-09-22T10:10:00Z',
    },
    {
      id: 's4',
      category: 'sorry',
      title: 'A promise, not an apology',
      content:
        'When I see you go quiet, I will ask — not wait for you to come to me.\n\nNo more making you knock.',
      created_at: '2024-09-22T10:15:00Z',
    },
  ],
  appreciation: [
    {
      id: 'a1',
      category: 'appreciation',
      title: 'You water my plants',
      content: 'You think I have not noticed. I have noticed every single time. You water the basil even though you think basil is “a scam plant”.',
      created_at: '2024-10-01T10:00:00Z',
    },
    {
      id: 'a2',
      category: 'appreciation',
      title: 'You remember the small things',
      content: 'The fact that you know I take two sugars. That you remember which song I hate. Nobody else has ever bothered with the inventory of me.',
      created_at: '2024-10-01T10:05:00Z',
    },
    {
      id: 'a3',
      category: 'appreciation',
      title: 'You let me win at small things',
      content: 'Every single game. Every single time. I noticed at about round forty and it has been doing something to me ever since.',
      created_at: '2024-10-01T10:10:00Z',
    },
    {
      id: 'a4',
      category: 'appreciation',
      title: 'The way you talk to strangers',
      content: 'You were patient with the waiter who got the order wrong. I watched you do it and thought: this is the person I want to be standing next to at the good table.',
      created_at: '2024-10-01T10:15:00Z',
    },
  ],
  love: [
    {
      id: 'l1',
      category: 'love',
      title: 'The short version',
      content: 'I love how you look slightly annoyed before you smile. It is the most reliable thing in the world.',
      created_at: '2024-10-05T10:00:00Z',
    },
    {
      id: 'l2',
      category: 'love',
      title: 'On ordinary mornings',
      content: 'Nobody writes about loving someone while they are brushing their teeth with toothpaste on their chin. I do. That is the whole thing.',
      created_at: '2024-10-05T10:05:00Z',
    },
    {
      id: 'l3',
      category: 'love',
      title: 'Because you stayed',
      content: 'You could have. That is the entire sentence. You could have, and you stayed, and I have never been more careful with anything in my life.',
      created_at: '2024-10-05T10:10:00Z',
    },
    {
      id: 'l4',
      category: 'love',
      title: 'The long version',
      content: 'I love you past the end of this sentence and past the end of this card. I love you in ways I am still finding words for at two in the morning.',
      created_at: '2024-10-05T10:15:00Z',
    },
  ],
  comfort: [
    {
      id: 'c1',
      category: 'comfort',
      title: 'Open when you can’t sleep',
      content: 'Come here. You don’t have to say anything. I will just stay awake with you until it gets boring and then we will both fall asleep.',
      created_at: '2024-10-10T10:00:00Z',
    },
    {
      id: 'c2',
      category: 'comfort',
      title: 'Open when you feel like a burden',
      content: 'You are not a thing to be managed. You are the person I want next to me at the difficult dinner and the boring Tuesday and the waiting room.',
      created_at: '2024-10-10T10:05:00Z',
    },
    {
      id: 'c3',
      category: 'comfort',
      title: 'Open when you are angry at me',
      content: 'Take your time. I would rather wait a whole day than have you swallow it. I will still be here when you’re ready to say it properly.',
      created_at: '2024-10-10T10:10:00Z',
    },
    {
      id: 'c4',
      category: 'comfort',
      title: 'A hug, delivered',
      content: 'Consider yourself held for approximately nine seconds. Now consider yourself held for considerably longer, pending my availability.',
      created_at: '2024-10-10T10:15:00Z',
    },
  ],
};