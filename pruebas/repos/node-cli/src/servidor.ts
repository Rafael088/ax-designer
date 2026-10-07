import express from "express";
import { leerEstado } from "./almacen.ts";

const app = express();
app.get("/estado", (_req, res) => res.json(leerEstado()));
app.post("/tareas/:id/entregar", (_req, res) => res.json({ ok: true }));
