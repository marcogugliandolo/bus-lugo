# Xa Vén

«Xa vén» significa «ya viene» en gallego.

Los autobuses urbanos de Lugo en el móvil, la tablet y el ordenador: sus 24 líneas, 417 paradas y horarios oficiales, en castellano y en gallego.

- **El mapa con los buses moviéndose.** Cada bus va donde debería ir según el horario, y la web lo dice («según horario»).
- **En directo cuando alguien va dentro.** Quien pulsa «Voy en este bus» y acepta compartir corrige ese bus para todos: se pone verde y sus horas pasan a ser «en directo».
- **«Suele ir 3 min tarde».** Con lo que comparten los viajeros, cada salida aprende su retraso habitual.
- **Avisos al móvil aunque esté bloqueado:** antes de que llegue el bus y antes de bajarse.
- **Tus paradas** en la portada, con sus próximos buses nada más abrir.
- **Funciona sin cobertura:** la web y los horarios se quedan guardados en el móvil.
- **Pantalla de parada** para una tele, una tablet o una Raspberry Pi.
- **Una página por parada y por línea**, con su horario, para que Google las encuentre.
- **Autobuses de la Xunta** que salen a pocos pasos de cada parada.

Nadie publica la posición de estos buses, así que lo que no es «en directo» es una estimación a partir del horario, y la web lo indica siempre.

## Desplegar en Portainer

1. Sube este repositorio a GitHub como `marcogugliandolo/bus-lugo`.
2. **Stacks › Add stack › Web editor** y pega `docker-compose.yml`.
3. Despliega en Servidor-Contabo. El contenedor entra en la red `npm-master_default` y publica el puerto `3091` (se cambia con `BUS_PORT`).
4. En Nginx Proxy Manager, apunta `bus.marcogugliandolo.com` a `http://bus-lugo:3000` con https.

`/` redirige a `/demo/`. Para publicar cambios: push a GitHub y reinicia los dos contenedores (`bus-lugo` y `bus-lugo-push`).

Variables opcionales, en **Environment variables** del stack:

| Variable | Para qué |
| :--- | :--- |
| `BUS_PORT` | Puerto del servidor (3091). |
| `OPERADOR=1` | Enseña en cada parada los minutos de su sistema de información (lo que abre el QR del poste). **Apagado por defecto**: lee una página del operador que no está publicada para reutilizarse. Se pide con mesura (solo la parada que alguien abre, guardada 20 s, máximo 120 peticiones por minuto) y la web no los presenta como medidos. Actívalo solo si te parece bien, y mejor tras preguntar al Concello o a AULUSA. |
| `INTERURBANOS=0` | No descargar los horarios de los autobuses de la Xunta. |
| `GTFS_URL` | Otra dirección para el GTFS de la Xunta. |

## La API (`server/`)

El contenedor `bus-lugo-push` sirve todo `/api/` y guarda sus datos en el volumen `bus-lugo-avisos`. No hay nada que configurar ni secretos en el repositorio.

| Ruta | Qué hace |
| :--- | :--- |
| `/api/avisos` | Guarda los avisos y envía la notificación a su hora con Web Push (`push.mjs`). |
| `/api/vivo` | Recibe la posición de quien va en el bus y devuelve el retraso de cada carrera vista en los últimos dos minutos (`vivo.mjs`). |
| `/api/retrasos` | Cuánto suele retrasarse cada salida, cuando hay al menos tres días vistos. |
| `/api/interurbanos/<parada>` | Autobuses de la Xunta que salen a menos de 150 m (`interurbanos.mjs`). |
| `/api/parada/<parada>` | Minutos del sistema de información de la parada, solo con `OPERADOR=1` (`operador.mjs`). |

**Privacidad de «Voy en este bus».** Solo se comparte si la persona lo acepta, y solo mientras tiene la pantalla abierta. El móvil envía la carrera y el punto redondeado a unos 10 m, sin ningún identificador. El servidor comprueba que esa carrera está en marcha y que el punto está sobre su recorrido, calcula el retraso y **no guarda la posición**. En memoria solo queda el retraso, que se olvida a los dos minutos. En disco, por cada salida y día, un único número: la mediana del retraso que se vio. Para limitar envíos usa la IP mezclada con un secreto que cambia cada día, y no la guarda.

**Interurbanos.** Una vez al día descarga el GTFS de la Xunta desde la Mobility Database, se queda con las paradas cercanas a las urbanas y las salidas de los próximos ocho días, y guarda el resultado en `interurbanos.json`. Si la descarga falla, sigue con lo último que tenía.

Pruebas: `cd server && npm ci && node --test`.

## Probarlo en el ordenador

```bash
cd server && npm ci && cd ..
node tools/servidor-local.mjs        # http://localhost:8080/  (PUERTO=…, OPERADOR=1, INTERURBANOS=1)
```

Sirve la web, las páginas y la API como en el servidor, y guarda los datos en `.datos-locales/`.

## Pantalla de parada

`/demo/pantalla.html` deja elegir una o dos paradas y cuánto se tarda andando hasta ellas. Con la caminata puesta, dice «Sal en 4 min» en vez de cuándo pasa el bus. La pantalla no se apaga y cambia un píxel de sitio cada minuto para no marcar la tele.

En una Raspberry Pi, con el escritorio y Chromium:

```bash
chromium --kiosk --noerrdialogs --disable-session-crashed-bubble "https://bus.marcogugliandolo.com/demo/pantalla.html#s19"
```

Para que arranque sola, pon esa línea en `~/.config/autostart` o en el arranque del escritorio.

## Cómo se calculan los tiempos

- **Horas de paso:** cada carrera se ancla a los puntos que publica el operador. Entre ellos, las paradas se reparten según el tiempo medido por carretera en cada tramo, estirado para coincidir con la hora publicada.
- **Movimiento:** el bus arranca a la hora de cada parada, acelera unos 10 s, circula, frena y espera unos 20 s en la siguiente parada.
- **Cabeceras:** al terminar, el bus espera en la cabecera hasta su siguiente salida, si es en menos de 20 minutos y desde el mismo sitio.
- **En directo:** si alguien que va en el bus comparte, el retraso que lleva (la mediana si son varios) mueve el bus en el mapa y las horas de las paradas que le quedan.
- **Hora:** siempre la de Lugo, y los festivos usan el horario de domingo.
- **Lo que no puede saber sin viajeros:** tráfico, retrasos, desvíos por obras ni la ocupación del bus.

## Actualizar los datos

`app/demo/data/` se genera desde [Urbanos de Lugo](https://github.com/urbanos-lugo/urbanos-lugo.github.io), que transcribe buslugo.com. Después se regeneran las páginas de paradas y líneas:

```bash
git clone --depth 1 https://github.com/urbanos-lugo/urbanos-lugo.github.io.git /tmp/urbanos
npx esbuild tools/build-network.ts --bundle --platform=node --format=cjs --external:react \
  --alias:@urbanos=/tmp/urbanos/src --outfile=/tmp/build.cjs
node /tmp/build.cjs app/demo/data
node tools/build-pages.mjs
```

`tools/check-sim.ts` compara el simulador con el código original. Se compila igual, añadiendo `--define:GRACE=5 --define:HORIZON=120`, y se ejecuta con `TZ=Europe/Madrid`. Los festivos cubren 2026 y 2027: hay que regenerar los datos cuando ese proyecto añada 2028.

## Idiomas

Los textos se escriben en castellano dentro de `t('…')` y su traducción al gallego está en `app/demo/i18n.js`. `node tools/check-i18n.mjs` avisa de lo que falte por traducir.

## Archivos

```
app/demo/index.html, style.css   la página
app/demo/app.js                  mapa, panel, reloj, avisos y «Voy en este bus»
app/demo/sim.js                  dónde está cada bus y cuándo llega (también lo usa el servidor)
app/demo/plan.js                 cómo llegar de un sitio a otro
app/demo/live.js                 lo que llega en directo del servidor
app/demo/i18n.js                 castellano y gallego
app/demo/sw.js                   la web sin cobertura y las notificaciones
app/demo/pantalla.html, .js      pantalla de parada
app/demo/data/                   red, calles y estilos del mapa
app/demo/vendor/                 MapLibre y tipografías, sin CDN
app/parada, linea, paradas, lineas, sitemap.xml, robots.txt   páginas generadas por tools/build-pages.mjs
server/                          la API
nginx.conf                       servidor en el puerto 3000
docker-compose.yml               stack para Portainer
```

Licencias y procedencia de los datos en [NOTICE.md](NOTICE.md).

## Avisos al móvil

En iPhone las notificaciones web solo funcionan si la web se añade a la pantalla de inicio y se abre desde allí.

## Cómo llegar

`app/demo/plan.js` calcula el viaje entre dos puntos con los horarios: andando, en un bus o con un transbordo. Los sitios y calles se buscan con Photon, sobre datos de OpenStreetMap. Comprobación: `node tools/check-plan.mjs`.
