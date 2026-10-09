import type { NextApiRequest, NextApiResponse } from "next";

const tareas: { id: string; titulo: string }[] = [];

export default function manejador(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case "GET": {
      const { estado } = req.query;
      return res.status(200).json({ data: tareas.filter(() => estado === undefined), error: null });
    }
    case "POST":
      tareas.push(req.body);
      return res.status(201).json({ data: req.body, error: null });
    default:
      return res.status(405).json({ error: "Método no permitido" });
  }
}
