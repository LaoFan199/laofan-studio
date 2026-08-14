export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(200).json({
    ok: true,
    configured: Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY),
    mode: 'paper-read-only'
  });
}
