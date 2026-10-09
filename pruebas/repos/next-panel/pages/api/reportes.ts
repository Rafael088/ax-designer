import type { NextApiRequest, NextApiResponse } from "next";

/** Un reporte viejo del Pages Router. */
export default function manejador(req: NextApiRequest, res: NextApiResponse) {
  const { formato = "json", limite = "10" } = req.query;
  const n = Math.min(Number(limite) || 10, 100);
  res.status(200).json({ formato, filas: n });
}
