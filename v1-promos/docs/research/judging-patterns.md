# What Hackathon Judges Actually Reward — evidence file

Researched 2026-11-18. Scope: crypto and AI hackathon judges, organizers, and winner write-ups. Only claims with a found source are included. Reliability tags: **[ORG]** = organizer/official rules, **[JUDGE]** = first-hand judge account, **[WINNER]** = winner/participant retrospective, **[GUIDE]** = community guide (weaker).

Caveat up front: there is no rigorous public dataset on what predicts crypto-hackathon wins. ETHBerlin-style judges themselves say "the randomness of hackathon judges is quite significant" (ETHDenver judges, [ChainCatcher](https://chaincatcher.com/en/article/2088765)). The evidence below is qualitative but very consistent across sources.

---

## Reference facts (formats and time budgets)

- **ETHGlobal finalists:** "Each team has **7 minutes** to present" = 4 min demo + 3 min Q&A. Async events: first round is async screening, "typically only the top 20%" advance to live judging. Criteria: Technicality, Originality, Practicality ("could be used by its target audience today?"), Usability (UI/UX/DX), WOW Factor ("Does your project leave a lasting impression?"). [ORG] [ETHGlobal Unite details](https://ethglobal.com/events/unite/info/details), [ETHOnline 2023 details](https://ethglobal.com/events/ethonline2023/info/details)
- **ETHGlobal sample Q&A questions:** "What inspired your project?", "What tools did you use, and why?", "What challenges did you solve, and how?" [ORG] (same page)
- **Devfolio** uses the same 5 criteria; "Finalists must demo live"; "Show project in action (not just slides)". [ORG] [Devfolio judging guide](https://guide.devfolio.co/docs/guide/participating-in-hackathons/judging-1)
- **MLH judging plan:** ~4 min per project: "2 minutes for presentation + demo, 1 minute for questions ... 1 minute for judge travel"; standard dimensions technology, design, completion, learning. [ORG] [MLH Judging Plan](https://guide.mlh.io/general-information/judging-and-submissions/judging-plan)
- **ETHDenver track judging:** 5 min demo + 3 min Q&A; one ETHDenver judge account reports pitches of only 90 s. [ORG]/[JUDGE] [ETHDenver judging](https://www.ETHDenver.com/buidl/judging), [ChainCatcher](https://chaincatcher.com/en/article/2088765)
- **Scale:** ETHGlobal Bangkok: 713 projects, 10 finalists (~1.4%). [The Block](https://www.theblock.co/post/326975/ethglobal-hackathons-10-finalists-showcase-ai-agents-crypto-games-dao-tools-and-more). Hack the North base rate: 161 of 3,443 projects made finalist (~4.7%) (via search summary of a Hack the North data tool; not independently verified).
- **Colosseum (Solana):** "The pitch video is the most important element of the submission. It is usually the first item judges review." Pitch video ≤3 min (the "why"); separate 2–3 min technical demo (the "how"). [ORG] [Colosseum workshop recap](https://blog.colosseum.com/perfecting-your-hackathon-submission/)

---

## (a) Evidence-backed rules for winning

### 1. Say what it is in one plain sentence before anything else
- "The teams that lost ground opened with context." Strong teams "opened with a plain declarative: this is a tool that does X for Y." The judge lost ~a third of a demo slot "trying to catch up" because a team hadn't said what the product was; rehearse the opening 30 s because "that is where the score is set." Projects that survive panel recall are "the ones with a one-line identity." [JUDGE] [Kurbaitaev, notes from a year of judging](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
- "If a judge only reads your first two paragraphs" they should already grasp the point. [ORG] [DoraHacks](https://dev.to/dorahacks/what-does-a-good-hackathon-submission-look-like-5398)
- ETHGlobal video rules: keep the backstory to ~20 seconds. [ORG] [ETHGlobal Unite](https://ethglobal.com/events/unite/info/details)

### 2. Show it working, live, early — the demo beats the code
- "The team with the best code almost never wins. The team with the best demo does." "Show the hardest thing working." [WINNER] [Push to Prod, How to Win Hackathons](https://getpushtoprod.substack.com/p/how-to-win-hackathons)
- A live demo "removes doubt, and doubt is what a judge is actually managing under time pressure." [JUDGE] [Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
- "If there is a demo, it must be shown, even if it's just a quick 10-second overview." [JUDGE] [ETHDenver judges via ChainCatcher](https://chaincatcher.com/en/article/2088765)
- "The live demo with real data made us trust it works." (judge quote reported by a Smart India Hackathon winner) [WINNER] [Reskilll SIH](https://blogs.reskilll.com/how-i-won-smart-india-hackathon-lessons-36-hours-changed-everything/)
- 0G Labs (ETHGlobal Lisbon 2026 sponsor): live demo was mandatory for prize submissions (search summary). [0G recap](https://0g.ai/blog/ethglobal-lisbon-2026-recap)

### 3. Scope ruthlessly: one complete path beats a platform
- "A team that built one narrow thing well reads as a team that made decisions." "A team that built a platform in 36 hours reads as a team that did not." "One complete path through the product beats four half-built paths." [JUDGE] [Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
- "We scoped ruthlessly... Every feature we cut was a feature that couldn't break during the demo." Frame gaps as "We scoped that out intentionally to focus on the core experience." [WINNER] [Push to Prod](https://getpushtoprod.substack.com/p/how-to-win-hackathons)
- "Judges evaluate the solution, not the complexity of your implementation." [WINNER] [Reskilll SIH](https://blogs.reskilll.com/how-i-won-smart-india-hackathon-lessons-36-hours-changed-everything/)
- "completion matters more than perfection." [GUIDE] [TechFlow on ETHGlobal finalists](https://www.techflowpost.com/en-US/article/14630)

### 4. Make the magic visible — judges score what they can see
- A losing team's backend work was invisible: judges "just saw a list of tickets created"; winners were "technically simpler" but solved "a highly visible, painful problem" instantly understandably. [WINNER-adjacent] [anuragpo, hackathon lessons](https://anuragpo.is-a.dev/writing/hackathon)
- Pitfall: "submitting something technically interesting but hard to understand." [ORG] [Superteam DE guide](https://superteamde.gitbook.io/superteamde/hackathon-hub/submission-and-pitching)
- Translation of intent → observable action is what makes AI demos legible (RoboChef example). [GUIDE] [What AI hackathon winners have in common](https://dev.to/jsb-securedme/what-ai-hackathon-winners-actually-have-in-common-1kla)

### 5. Real users / real problem evidence moves crypto judges
- "judges look for evidence that a team is solving a real problem for real users." Standout projects show early traction and user conversations (Twitter/Telegram feedback). [ORG] [Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/)
- Judge test: whether you "talked to anyone or guessed." [JUDGE] [Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
- ETHGlobal Practicality criterion literally asks whether it "could be used by its target audience today?" [ORG] [ETHGlobal](https://ethglobal.com/events/unite/info/details)

### 6. Justify the chain — "why blockchain?" is asked every time
- ETHDenver judges ask each team "Why does this problem need to be solved with blockchain?" and visibly lose interest at database-shaped problems. [JUDGE] [ChainCatcher](https://chaincatcher.com/en/article/2088765)
- Colosseum lists "Failing to explain the Solana integration clearly" as a common mistake; technical demo should explain on-chain logic and "Judges are particularly interested in the reasoning behind these decisions." [ORG] [Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/)
- Superteam: "not explaining the Solana-specific design" is a top mistake. [ORG] [Superteam DE](https://superteamde.gitbook.io/superteamde/hackathon-hub/submission-and-pitching)

### 7. Sponsor/track prizes reward deep, real integration — not logo-stapling
- KeeperHub reviewed all 180 ETHGlobal Open Agents submissions; ~30 were "surface integrations"; "A shallow integration with a polished pitch is not a winner." Winners had live deployments, tests (125), real x402 payments, 450 mainnet txs. Bar: could the sponsor "merge, adopt, or build on directly." Only 3 of 5 prize slots were awarded. [JUDGE/sponsor] [KeeperHub wrap](https://keeperhub.com/blog/010-openagents-hackathon-wrap)
- Blockscout winners' advice: "Don't just use Blockscout as an explorer" — use the full SDK. 7 of 10 ETHGlobal Prague finalists used Blockscout. [sponsor] [Blockscout learnings](https://www.blog.blockscout.com/learnings-from-ethglobal-prague)
- ETHGlobal caps partner prizes at 3 per project; the partner's assessment depends on the prizes you pick. [ORG] [ETHOnline 2023](https://ethglobal.com/events/ethonline2023/info/details)
- Spell sponsor usage out: "Spell it out explicitly in your project description." "Don't assume judges will dig through your code." [ORG] [DoraHacks](https://dev.to/dorahacks/what-does-a-good-hackathon-submission-look-like-5398)

### 8. Talk to sponsor judges during the event; they're in the room
- "The sponsors are the judges. They're in the room. Use them." Author scrapped six hours of work after one sponsor conversation and won that track; sponsors "want to hear their product name on stage." [WINNER] [Push to Prod](https://getpushtoprod.substack.com/p/how-to-win-hackathons)

### 9. Novelty matters — and judges have seen the obvious idea many times
- "The choice of topic should focus on novelty; lack of novelty means wasted effort." [JUDGE] [ETHDenver judges](https://chaincatcher.com/en/article/2088765)
- ETHGlobal Originality criterion; Wow Factor = "lasting impression." [ORG] [ETHGlobal](https://ethglobal.com/events/unite/info/details)
- Finalist taste skews to real-world interaction: 3 of 10 ETHGlobal Istanbul finalists used NFC. [GUIDE] [TechFlow](https://www.techflowpost.com/en-US/article/14630)
- SIH winner moved to a less crowded topic, odds from ~1-in-15 to ~1-in-3. [WINNER] [Reskilll SIH](https://blogs.reskilll.com/how-i-won-smart-india-hackathon-lessons-36-hours-changed-everything/)

### 10. Polish to "looks like a real product", no further
- "A visual that is good enough to look like an ordinary product is basically sufficient." [JUDGE] [ETHDenver judges](https://chaincatcher.com/en/article/2088765)
- Excess polish makes judges "wonder where the backend time went." [JUDGE] [Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
- "A clear and well-structured narrative is more valuable than professional video editing." [ORG] [Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/)

### 11. Be honest about limits; prepare for sharp questions
- "Admitting a limitation raised scores in my sheets." "Teams that say nothing breaks lose credibility instantly." [JUDGE] [Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
- "Be prepared to answer some very sharp questions from the judges" (e.g., which parts are centralized); expect "Which parts of this project were done during the competition?" [JUDGE] [ETHDenver judges](https://chaincatcher.com/en/article/2088765)
- Losing example: judge asked "What if the transcript makes a mistake and creates 20 garbage issues...?" and the team had no answer. [anuragpo](https://anuragpo.is-a.dev/writing/hackathon)
- Don't overstate traction — judges verify (Colosseum community guides, per search summary).

### 12. Make it trivially accessible: deployed link, no login wall, working links
- "deploying it to @vercel or @Netlify for judges to access would be very useful." [JUDGE] [ETHDenver judges](https://chaincatcher.com/en/article/2088765)
- "Judges can only evaluate what they can see." A private repo or dead link may mean the project is never reviewed; spend ~10 min checking every link. [ORG] [DoraHacks](https://dev.to/dorahacks/what-does-a-good-hackathon-submission-look-like-5398)
- Colosseum/Superteam both list "forgetting repo or doc access for judges." [ORG] [Superteam DE](https://superteamde.gitbook.io/superteamde/hackathon-hub/submission-and-pitching)
- Chainlink: offer judges a live working demo they can explore; README is "the first thing judges and other developers will see" — include overview, video link, live link, architecture diagram, run steps, and put impact at the top. [ORG] [Chainlink blog](https://chain.link/blog/blockchain-hackathon-tips)

### 13. Tell a user story, not a feature list (especially in video)
- "Judges will only watch three minutes, so you need to hook them fast"; open with the protagonist and their frustration for ~15–20 s; land hook and proof within 60–90 s; "focus your narration on what the user is achieving"; "Proof first, polish second." [ORG] [RevenueCat Shipaton](https://www.revenuecat.com/blog/engineering/how-to-win-shipaton-part-4-pitching-your-app)
- "Lead with the problem your hack solves and tell a good story... The technical details land better after the audience already cares." [WINNER] [Push to Prod](https://getpushtoprod.substack.com/p/how-to-win-hackathons)
- Colosseum: treat the pitch video "as a startup pitch rather than a product demo." [ORG] [Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/)

### 14. Rehearse and carry a backup
- "After five pitches, you'll know your content cold"; identify "punchlines that grab attention." [GUIDE] [TechFlow](https://www.techflowpost.com/en-US/article/14630)
- SIH winner practiced the 3-min demo 5 times and kept a recorded backup video. [WINNER] [Reskilll SIH](https://blogs.reskilll.com/how-i-won-smart-india-hackathon-lessons-36-hours-changed-everything/)
- "Record a 60-second screen capture of the working flow as insurance" + one screenshot "as a fallback if the wifi died." [JUDGE] [Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)
- Push to Prod's event switched to pre-recorded videos at the last minute — have one ready. [WINNER] [Push to Prod](https://getpushtoprod.substack.com/p/how-to-win-hackathons)

### 15. Live on-stage payments / audience participation: precedent exists but evidence is thin
- Fortune (2014 bitcoin hackathon): first demo presenter asked an audience member to send a bitcoin payment on stage and the device signaled receipt. [Fortune](https://fortune.com/2014/11/22/bitcoin-hackathon/). TechCrunch Disrupt Europe hack Beatcoin "turned everyone's phone into a jukebox" via bitcoin micropayments. [TechCrunch](https://techcrunch.com/2013/10/27/beatcoin-is-a-music-jukebox-hack-powered-by-bitcoin-micropayments)
- I found **no** judge-authored source explicitly saying audience-phone participation wins. Treat it as a WOW-factor tactic consistent with rules 2/4/9, not as a proven rule. It also adds failure risk (wifi, wallets) — see "dead time" anti-pattern.

---

## (b) Anti-pattern checklist

- [ ] Opening with context/backstory instead of "X for Y" ([Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l); ETHGlobal ~20 s backstory cap)
- [ ] Slides-only / slide-heavy: "They fill time. They do not persuade." ([Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l)); ETHGlobal/Devfolio: max 4 bullets per slide, "not just slides"
- [ ] Spending demo time on stack decisions ([Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l))
- [ ] Building a "platform" / too many half-working features ([Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l), [Push to Prod](https://getpushtoprod.substack.com/p/how-to-win-hackathons))
- [ ] Blockchain where a database would do; no answer to "why chain?" ([ChainCatcher](https://chaincatcher.com/en/article/2088765))
- [ ] Shallow sponsor integrations / stapling SDKs for bounties ("surface integrations") ([KeeperHub](https://keeperhub.com/blog/010-openagents-hackathon-wrap)); applying to more than 3 partner prizes isn't even allowed at ETHGlobal
- [ ] Polished pitch on shallow substance; "hype montage" video; buzzwords like "revolutionary" ([KeeperHub](https://keeperhub.com/blog/010-openagents-hackathon-wrap), [Superteam DE](https://superteamde.gitbook.io/superteamde/hackathon-hub/submission-and-pitching), [DoraHacks](https://dev.to/dorahacks/what-does-a-good-hackathon-submission-look-like-5398), [Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/))
- [ ] Invisible backend magic — judges only see an output list ([anuragpo](https://anuragpo.is-a.dev/writing/hackathon))
- [ ] Dead air (waiting on MetaMask/wallet popups, tx confirmations) ([Devfolio](https://guide.devfolio.co/docs/guide/participating-in-hackathons/judging-1), [ETHGlobal](https://ethglobal.com/events/unite/info/details))
- [ ] Claiming nothing breaks / overstating traction ([Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l))
- [ ] Login walls / broad OAuth for judges; no demo account (judge account via search summary); private repo, dead links, no doc access ([DoraHacks](https://dev.to/dorahacks/what-does-a-good-hackathon-submission-look-like-5398), [Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/))
- [ ] Video violations: over time limit, <720p, sped-up footage, phone-recorded, TTS/AI voice, music + text only ([ETHGlobal](https://ethglobal.com/events/unite/info/details), [Devfolio](https://guide.devfolio.co/docs/guide/participating-in-hackathons/judging-1))
- [ ] Single-commit repo or reused pre-hackathon project (disqualification risk) ([Devfolio](https://guide.devfolio.co/docs/guide/participating-in-hackathons/judging-1), [ChainCatcher](https://chaincatcher.com/en/article/2088765))
- [ ] Vague about product and user; omitting team background ([Superteam DE](https://superteamde.gitbook.io/superteamde/hackathon-hub/submission-and-pitching), [Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/))
- [ ] Treating the hackathon as an endpoint rather than a starting point ([Colosseum](https://blog.colosseum.com/perfecting-your-hackathon-submission/))
- [ ] Over-polishing UI at the expense of the core path ([Kurbaitaev](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l), [ChainCatcher](https://chaincatcher.com/en/article/2088765))

Not found as an explicit judge quote: the "it's like X but onchain" phrasing. The closest documented equivalents are "why blockchain?" and "similar or repetitive ideas are easily penalized" (TechFlow summary of ETHDenver judging).

---

## (c) Implications

### 5-minute live finals pitch (+2 min Q&A)
Derived from rules 1, 2, 4, 6, 11, 13, 14. ETHGlobal-style finalists get 4 min demo, so 5 min is generous; most of it should be the product running.

| Time | Beat | Evidence |
|---|---|---|
| 0:00–0:15 | One-line identity: "X is a [thing] that does Y for Z." | Rule 1 |
| 0:15–0:40 | Problem story with a concrete person/moment (≤20–25 s of backstory) | Rules 1, 13 (ETHGlobal 20 s, RevenueCat 15–20 s) |
| 0:40–3:15 | **Live demo** of the single complete path; hardest thing working; on-chain effect made visible (explorer link/tx appearing on screen); pre-funded wallets, pre-opened tabs, no waiting on popups | Rules 2, 3, 4; anti-pattern "dead air" |
| 3:15–3:50 | Why it must be on-chain + which sponsor tech does what (named explicitly) | Rules 6, 7 |
| 3:50–4:30 | Evidence of real users/demand (conversations, testers, named pilot if real) + one honest limitation and what's next | Rules 5, 11 |
| 4:30–5:00 | Close on the one-liner / "lasting impression" moment | Rule 9 (WOW factor) |

Q&A prep (2 min): rehearse answers to ETHGlobal's sample questions ("what inspired", "what tools and why", "what challenges"), "why blockchain?", "what's centralized?", "what was built during the event?", and the failure-mode question for your core feature. Keep a 60-s recorded screen capture + screenshot fallback ready. Rehearse ≥5 times, especially the first 30 s.

Audience-phone / live tx moment: optional WOW tactic (rule 15). Only do it if it cannot stall; precedent exists but no judge source says it wins.

### 2–3 minute demo video (Devpost-style)
Judges often watch the video first (Colosseum) and screen async (ETHGlobal top-20% cut), so the video decides whether you reach finals.

- **0:00–0:10** — one-line identity on screen + voice.
- **0:10–0:30** — problem as a user moment (person + frustration).
- **0:30–2:00** — screen recording of the real product doing the core path end to end; narrate what the user achieves, not UI parts; cut all waiting (no speed-up — edit instead); show the on-chain tx/explorer proof.
- **2:00–2:30** — how it works: architecture in one diagram, why the chain, which sponsor tools and how deeply.
- **2:30–2:50** — traction/validation evidence and honest limits / next step.
- **2:50–3:00** — name, link, close.
- Production rules: human voice narration, ≥720p, desktop screen capture (not phone), clear audio, no music-plus-text, under the limit. Story clarity beats editing quality.

### README / submission
Top: one-liner + impact; then video link, live deployed link (no login wall or a demo account), architecture diagram, explicit "Sponsor X used for Y (file links)" section, run steps, and a short "built during the hackathon" note with a real commit history. Test every link and access permission before submitting.
