# CardBuddy Virtual Collections

Status: **test-branch front-end prototype**  
Branch: `virtual-collections-test`

## Product boundary

Virtual Collections is a separate collecting economy. It must never read from, write to, or transfer items into the user's physical collection or physical binder. Existing physical collection and binder data remains unchanged.

The virtual area has its own navigation entry, coin balance, inventory, pack-opening history, binder and daily challenge progress. Friend visibility is opt-in and separate from permission to trade.

## Pack economy

| Pack | Price | Cards | Common | Uncommon | Rare | Epic | Legendary | Grail |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Starter | 100 | 5 | 60% | 25% | 12% | 2.5% | 0.45% | 0.05% |
| Premium | 200 | 5 | 40% | 25% | 20% | 10% | 4% | 1% |
| Elite | 350 | 6 | 25% | 25% | 25% | 15% | 8% | 2% |
| Legendary | 550 | 6 | 15% | 20% | 25% | 20% | 15% | 5% |

Odds are per card, not guaranteed pack contents. Each row totals 100%. Values are starting balance targets and should be configurable and reviewed against real opening simulations before launch.

Daily check-in: 25 coins. Prototype challenge targets: first pack +25, five packs +75. Friend trade +50 and mystery swap +25 are planned but intentionally unavailable until server-side trade safeguards exist.

The 175-to-200 coin example is supported: a player with 175 coins can open a Starter now, or claim the next daily check-in to reach 200 and buy Premium.

## Pack-opening flow

1. Show eight selectable packs.
2. Chosen pack expands to a full-screen view.
3. Swipe across the top seal to trigger the foil-rip animation.
4. Sparkle / reveal transition.
5. Cards appear one by one, with rarity-specific framing.
6. Player adds the revealed cards to the virtual binder.

The pack result must be committed before the animation plays. Closing or refreshing during a real opening must never duplicate, reroll, or lose a paid pack.

## Virtual binder and catalogue

The virtual binder is a separate inventory and should reuse the existing nine-pocket binder presentation where possible. Virtual card records need unique inventory IDs, even for duplicate copies of the same card.

The planned catalogue is all supported Pokémon TCG sets and generations, using TCGDex card/set metadata and artwork. Card rarity labels need a maintained mapping into the six internal trading tiers above.

## Trading rules

- Friend-to-friend trades require both players to review and accept the exact offer.
- Collection visibility and trading permission are separate opt-ins.
- Mystery trades return a random eligible card from the same internal rarity tier.
- Never trade a card for itself; validate ownership and availability at commit time.
- Proposed initial limits: 3 mystery trades and 5 completed friend trades per account per day.
- Add cooldowns, immutable transaction history, replay protection and server-side rate limits.
- Card transfer and any coin/reward changes must be atomic.

## Required production backend

The current prototype intentionally stores its test wallet and inventory in browser local storage. This is only to test layout and pack-opening interaction. It is **not** a secure economy and must not be used for public trading or valuable progression.

Before public release, add a separate Supabase virtual schema with:
- virtual profiles / wallets
- virtual inventory
- pack definitions and versioned odds
- pack opening records
- coin ledger
- daily reward claims
- friend trade offers and trade items
- mystery trade limits / audit records
- virtual collection visibility and trading permissions

All minting, pack rolls, coin deductions, rewards, rarity matching and card transfers must run through authenticated server-side RPCs or Edge Functions. RLS must prevent users from writing their own balances, inventing inventory, changing pack odds or reading private friend inventory. Use idempotency keys and database transactions for every economy-changing action.

Do not apply the production migration to the live project. Test against a dedicated staging Supabase project and two separate test accounts first.

## Card catalogue and regional discovery

Pack pulls use TCGDex's English Pokémon card catalogue and display the card's full artwork image one at a time. The first prototype caches the catalogue for the current browser session. If TCGDex is unavailable, it falls back to species artwork so the interaction can still be tested.

The regional Pokédex is driven by the existing National Pokédex species reference data, grouped into the nine region/generation collections already defined by the app. Entries remain `???` until a matching Pokémon card is pulled. A pulled card only unlocks a species when its card name can be matched to the species catalogue.

Virtual binders have their own local data store, separate from the existing physical binder IndexedDB store. They use the same nine-pocket CSS layout, page controls, page-turn animation, card captions, drag-and-drop slot swapping, and page-edge drag movement. Players can create, rename and delete multiple virtual binders. Deleting a binder never deletes inventory cards.

## Current test-branch scope

Implemented in this branch:
- Separate Virtual navigation entry and section
- Four pack tiers and eight-pack selection
- Four dedicated CardBuddy SVG pack-front assets using the approved blue, purple, green and gold visual family
- TCGDex full-card artwork with one-at-a-time reveal controls
- Multiple independent virtual binders with nine-pocket pages, add/remove card placement, drag-and-drop rearranging and page navigation
- Regional Pokédex with undiscovered entries masked as `???`
- Full-screen pack selection and swipe-to-rip interaction
- Sparkle / staged card reveal
- Starter / Premium / Elite / Legendary visual themes
- Local prototype coin wallet and daily check-in
- Local virtual inventory and separate multi-binder storage
- Daily challenge display, with trading challenges marked as coming soon
- Service-worker precache entry and cache version bump

Not yet implemented:
- Supabase persistence or secure pack-opening RPC
- Full production TCGDex catalogue ingestion and robust species matching/rarity mapping
- Reuse of the physical binder's nine-pocket component for virtual inventory
- Friend collection visibility for virtual cards
- Friend-to-friend and mystery trading
- Server-side anti-farming, transaction ledger and reward claims

These items are deliberately separated so the visual prototype cannot be mistaken for a secure, production-ready trading economy.


## Regional NPC trader gallery prototype

The regional trader gallery adds Bill (Kanto), Kurt (Johto), Steven (Hoenn), Cynthia (Sinnoh), N (Unova), Professor Sycamore (Kalos), Professor Kukui (Alola), Hop (Galar) and Arven (Paldea). Each regional trader unlocks after the player discovers at least one Pokémon in that region's Pokédex. The existing Mystery Trader and General Collector remain available. Bill replaces Kanto Keeper.

Regional characters are a nostalgia-focused presentation layer, not region-restricted traders. Every NPC uses the same trade selector, rarity-matched review and confirmation flow. Portraits currently reference the Pokémon Showdown trainer-sprite archive; these are convenient prototype assets rather than a verified set of original game-ripped assets. Review provenance and artist credit requirements before public release, and replace any portrait that does not meet the intended art direction.


## Regional trader gallery scope clarification

The regional character gallery is a presentation layer only: name, character artwork, region/game-era label and short lore description. All NPCs use the same existing trade review and confirmation flow and the same rarity-matching rules. Bill replaces the former Kanto Keeper entry. Mystery Trader and General Collector remain. Regional characters unlock after the player discovers at least one Pokémon in that region's Pokédex. Selecting an unlocked gallery portrait selects that trader in the existing trade panel. The regional characters do not have bespoke trade scenes or individual trade mechanics in this prototype.
