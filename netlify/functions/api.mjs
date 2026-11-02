// Netlify serves /api/* through this function; locally the same routes run inside Vite (server/api.js).
// Keys come from the site's environment variables (Site configuration → Environment variables).
import { createHandler, httpError } from '../../server/api.js'

const handle = createHandler(process.env)

export default async (req) => {
  const readBody = () => req.json().catch(() => Promise.reject(httpError(400, 'Буруу хүсэлт')))
  const out = await handle(req.method, new URL(req.url), readBody)
  if (!out) return Response.json({ error: 'Олдсонгүй' }, { status: 404 })
  return Response.json(out[1], { status: out[0] })
}

export const config = { path: '/api/*' }
