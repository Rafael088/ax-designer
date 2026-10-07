# cli-verbos-es

Repo de mentira para `pruebas/rubrica/evaluar.test.ts`: un CLI argparse con verbos en español
que no son `listar`/`list` ni `detalle`/`obtener`/`get-`/`leer-`/`show`, para comprobar que
`contexto-progresivo` los reconoce igual. Reproduce el patrón que se encontró auditando un repo
real con `axd auditar` (verbos de lista y detalle con otro nombre), nunca el repo en sí.
