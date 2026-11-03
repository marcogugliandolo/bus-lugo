# Xa Vén

«Xa vén» significa «ya viene» en gallego.


Simulación en directo de los autobuses urbanos de Lugo, con sus 24 líneas, 417 paradas y horarios oficiales. Funciona en móvil, tablet y ordenador.

Es una **simulación**: nadie publica la posición real de estos buses. Cada bus se dibuja donde debería estar según el horario, y la web lo indica en todas las pantallas. Si se publica un feed oficial o se añade el GPS de los viajeros, solo hay que sustituir `busesAt` en `app/demo/sim.js`.

## Desplegar en Portainer

1. Sube este repositorio a GitHub como `marcogugliandolo/bus-lugo`.
2. **Stacks › Add stack › Web editor** y pega `docker-compose.yml`.
3. Despliega en Servidor-Contabo. El contenedor entra en la red `npm-master_default` y publica el puerto `3091` (se cambia con `BUS_PORT`).
4. En Nginx Proxy Manager, apunta `bus.marcogugliandolo.com` a `http://bus-lugo:3000` con https.

`/` redirige a `/demo/`. Para publicar cambios: push a GitHub y reinicia el contenedor.

## Cómo se calculan los tiempos

- **Horas de paso:** cada carrera se ancla a los puntos que publica el operador. Entre ellos, las paradas se reparten según el tiempo medido por carretera en cada tramo, estirado para coincidir con la hora publicada.
- **Movimiento:** el bus arranca a la hora de cada parada, acelera unos 10 s, circula, frena y espera unos 20 s en la siguiente parada.
- **Cabeceras:** al terminar, el bus espera en la cabecera hasta su siguiente salida, si es en menos de 20 minutos y desde el mismo sitio.
- **Hora:** siempre la de Lugo, y los festivos usan el horario de domingo.
- **Lo que no puede saber:** tráfico, retrasos, desvíos por obras ni la ocupación del bus.

## Actualizar los datos

`app/demo/data/` se genera desde [Urbanos de Lugo](https://github.com/urbanos-lugo/urbanos-lugo.github.io), que transcribe buslugo.com:

```bash
git clone --depth 1 https://github.com/urbanos-lugo/urbanos-lugo.github.io.git /tmp/urbanos
npx esbuild tools/build-network.ts --bundle --platform=node --format=cjs --external:react \
  --alias:@urbanos=/tmp/urbanos/src --outfile=/tmp/build.cjs
node /tmp/build.cjs app/demo/data
```

`tools/check-sim.ts` compara el simulador con el código original. Se compila igual, añadiendo `--define:GRACE=5 --define:HORIZON=120`, y se ejecuta con `TZ=Europe/Madrid`. Los festivos solo cubren 2026: hay que regenerar los datos cuando ese proyecto añada 2027.

## Archivos

```
app/demo/index.html, style.css   la página
app/demo/app.js                  mapa, panel y reloj
app/demo/sim.js                  dónde está cada bus y cuándo llega
app/demo/data/                   red, calles y estilos del mapa
app/demo/vendor/                 MapLibre y tipografías, sin CDN
nginx.conf                       servidor en el puerto 3000
docker-compose.yml               stack para Portainer
```

Licencias y procedencia de los datos en [NOTICE.md](NOTICE.md).

## Avisos al móvil

El servicio `server/push.mjs` (contenedor `bus-lugo-push`) guarda los avisos y envía la notificación a su hora con Web Push, aunque la web esté cerrada. Crea sus claves la primera vez en el volumen `bus-lugo-avisos`, así que no hay nada que configurar ni secretos en el repositorio. Pruebas: `cd server && npm install && node --test`.

En iPhone las notificaciones web solo funcionan si la web se añade a la pantalla de inicio y se abre desde allí.
