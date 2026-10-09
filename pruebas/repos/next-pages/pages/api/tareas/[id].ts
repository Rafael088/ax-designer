import type { NextApiRequest, NextApiResponse } from "next";

export default function manejador(req: NextApiRequest, res: NextApiResponse) {
  const id = req.query.id;
  if (req.method === "DELETE") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ data: { id }, error: null });
  return res.status(405).json({ error: "Método no permitido" });
}
