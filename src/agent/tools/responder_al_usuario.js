// Tool TERMINAL: responder_al_usuario
// Cierra el turno entregando la respuesta final con el contrato del widget
// { respuesta, productos, acciones }. El agent-loop la intercepta (no tiene
// handler ejecutable): sus argumentos SON la salida final del turno.
export const key = 'responder_al_usuario';

export const definicion = {
  type: 'function',
  function: {
    name: 'responder_al_usuario',
    description:
      'Entrega la respuesta final al usuario. Llama a esto cuando ya tengas todo lo necesario. El mensaje va en `respuesta`; los productos a mostrar como tarjetas (si aplica) en `productos`; los botones de accion en `acciones`. Esta es la UNICA forma de responder al usuario.',
    parameters: {
      type: 'object',
      properties: {
        respuesta: { type: 'string', description: 'El mensaje de texto para el usuario.' },
        productos: {
          type: 'array',
          description: 'Productos a mostrar como tarjetas (opcional). Solo incluye productos reales del conocimiento.',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              precio: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['nombre'],
          },
        },
        acciones: {
          type: 'array',
          description: 'Botones de accion (opcional), ej: enlaces a una pagina.',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['texto'],
          },
        },
      },
      required: ['respuesta'],
    },
  },
};

// Sin handler: es terminal. El loop usa sus argumentos como salida del turno.
