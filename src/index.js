// Entrada para desarrollo local: levanta el servidor HTTP.
import app from './app.js';

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`agente-back escuchando en http://localhost:${PORT}`);
});
