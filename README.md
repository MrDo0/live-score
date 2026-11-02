# Tennis Live

ATP / WTA, ATP Challenger / WTA 125 тэмцээний шууд үр дүн, тоглогчдын харьцуулалт, рейтинг. Vue 3 + Vite.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ — ямар ч static host дээр байршуулж болно
```

- Өгөгдөл: ESPN-ийн нээлттэй API (түлхүүр шаардлагагүй). LIVE тоглолт байхад 15 сек, бусад үед 60 сек тутам шинэчлэгдэнэ.
- Dev үед `/espn` Vite proxy-гоор, production-д ESPN руу шууд (CORS зөвшөөрөгдсөн) хандана.
- ESPN теннисний ace, давхар алдаа зэрэг тоглолтын дэлгэрэнгүй статистик өгдөггүй. Үүнийг нэмэхийн тулд төлбөртэй API (api-tennis.com, Sportradar гэх мэт) хэрэгтэй.

### Нэмэлт өгөгдлийн эх сурвалжууд

`.env.example`-ийг `.env` болгон хуулж түлхүүрүүдээ оруулна. Аль нэг түлхүүр байхгүй бол тухайн хэсэг л харагдахгүй, бусад нь ажиллана.

| Эх сурвалж | Түлхүүр | Юунд ашиглана | Кэш |
|---|---|---|---|
| ESPN | — | Тэмцээн, тоглолтын хуваарь, рейтинг, тоглогчийн мэдээлэл, дууссан тоглолтын оноо | 15 сек / 60 сек |
| [api-tennis.com](https://api-tennis.com) | `API_TENNIS_KEY` | ATP Challenger, WTA 125 тэмцээнүүд (ESPN-д байхгүй; хуваарь, оноо 30 сек кэш); LIVE тоглолтын геймийн оноо, сетийн оноо, төлөв, серв, статистик; LIVE "To Win" коэффициент; The Odds API хамардаггүй тэмцээний коэффициент (тоглолтын өмнөх) | 10 сек (live), 15 сек (live odds), 10 мин (odds) |
| [The Odds API](https://the-odds-api.com) | `ODDS_API_KEY` | Томоохон тэмцээний ~20 букмекерын коэффициент (EU, h2h), LIVE үед ч | 10 мин, LIVE үед 3 мин (`ODDS_LIVE_TTL_SEC`) |
| Claude | `ANTHROPIC_API_KEY` | "AI таамаг гаргах" товч — ялах магадлал (`claude-opus-5-5`) | тоглолт/оноо тус бүр |

Эдгээр нь `server/api.js` дээрх `/api/*` endpoint-ууд бөгөөд `npm run dev` / `npm run preview` болон Netlify дээр ажиллана (түлхүүр browser руу очихгүй). Бусад static host дээр зөвхөн ESPN-ийн хэсэг ажиллана.

### Netlify дээр байршуулах

`netlify.toml` бэлэн: `npm run build` → `dist/`, `/api/*` нь `netlify/functions/api.mjs` function-оор ажиллана.

1. GitHub дээр repo үүсгээд энэ төслийг push хийнэ (`.env` `.gitignore`-д байгаа тул түлхүүр очихгүй).
2. Netlify → **Add new project → Import an existing project** → GitHub repo-гоо сонгоно. Build тохиргоог `netlify.toml`-оос автоматаар уншина.
3. **Project configuration → Environment variables** хэсэгт `.env`-ийн утгуудыг (`API_TENNIS_KEY`, `ODDS_API_KEY`, `ANTHROPIC_API_KEY`) нэмээд дахин deploy хийнэ.

Netlify function нэг хүсэлтэд ~10 сек хязгаартай; AI таамаг үүнээс удвал алдаа өгч магадгүй.
