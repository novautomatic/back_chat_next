// Tool: delegar_a  (orquestacion multi-agente)
// Deriva la conversacion a otro agente especialista del MISMO equipo. No tiene
// handler: el loop la intercepta y devuelve una señal de delegacion al
// orquestador, que ejecuta al especialista destino (con cota MAX_DELEGACIONES).
// Los especialistas disponibles se listan en el system prompt (## Equipo).
export const key = 'delegar_a';

export const definicion = {
  type: 'function',
  function: {
    name: 'delegar_a',
    description:
      'Deriva la conversacion a otro especialista del equipo cuando el caso corresponde mejor a su area. Usa la especialidad o el nombre EXACTO de la lista del equipo. No la uses si puedes resolver tu mismo.',
    parameters: {
      type: 'object',
      properties: {
        especialidad: { type: 'string', description: 'Especialidad o nombre del especialista destino (de la lista del equipo).' },
        motivo: { type: 'string', description: 'Por que derivas y que necesita el cliente (briefing para el especialista).' },
      },
      required: ['especialidad', 'motivo'],
    },
  },
};

// Sin handler: es una tool de control. El loop la intercepta (ver loop.js).
