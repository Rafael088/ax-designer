// Genera un CLI para el repo objetivo (no es el CLI propio de esta herramienta). El switch de
// abajo describe qué tipo de implementación le tocó a cada verbo generado; no son comandos de
// `herramienta` — por eso ninguno de estos nombres debería colarse en superficies.cli.
type Implementacion = { tipo: string };

export function queHace(impl: Implementacion): string {
  switch (impl.tipo) {
    case "resumen":
      return "Resume el dominio.";
    case "listar":
      return "Lista los registros.";
    case "leer":
      return "Lee un registro por id.";
    default:
      return "Sin implementar.";
  }
}
