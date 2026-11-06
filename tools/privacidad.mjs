// El texto de la página de privacidad (/privacidad/ y /privacidade/). La genera build-pages.mjs.
// Si cambia algo de lo que se guarda o se envía, hay que cambiarlo aquí y la fecha de arriba.

const UPDATED = { es: '6 de noviembre de 2026', gl: '6 de novembro de 2026' };

const es = `<article class="prose">
<h1>Privacidad</h1>
<p class="sub">Xa Vén no te pide cuenta, no usa cookies y no lleva publicidad ni programas que sigan lo que haces. Aquí tienes, punto por punto, qué pasa con tus datos.</p>

<div class="summary"><ul>
<li>No hace falta registrarse: Xa Vén no sabe quién eres.</li>
<li>No hay cookies de seguimiento, ni analítica, ni publicidad.</li>
<li>Tu ubicación se usa en tu móvil y no se guarda en ningún sitio.</li>
<li>Solo sale de tu móvil lo que tú decides enviar: un aviso de la campana, un aviso por WhatsApp, por dónde va el bus si compartes «Voy en este bus» o un mensaje de «¿Algo no cuadra?».</li>
</ul></div>

<h2>Lo que se queda en tu móvil</h2>
<p>Tus paradas guardadas, el idioma, el modo claro u oscuro, la letra grande, los avisos que tienes puestos y si quieres compartir «Voy en este bus» se guardan en tu propio navegador. No son cookies de seguimiento y no salen del móvil. También se guarda una copia de la web para que abra sin cobertura. Para borrarlo todo, borra los datos de este sitio en los ajustes del navegador.</p>

<h2>Tu ubicación</h2>
<p>Solo si das permiso. Se usa en tu móvil para encontrar la parada más cercana, para «Cómo llegar a un sitio» y, cuando vas en el bus, para saber por dónde vas y avisarte antes de bajar. No se envía a Xa Vén ni se guarda, salvo lo que se explica en «Voy en este bus». Puedes quitar el permiso cuando quieras en los ajustes del navegador.</p>

<h2>Los avisos de la campana</h2>
<p>Para avisarte aunque tengas la web cerrada, tu navegador crea una dirección de avisos anónima (no lleva tu número ni tu nombre) y la manda al servidor de Xa Vén con la hora del aviso y su texto, por ejemplo «Línea 5: llega en 5 min». El servidor la guarda solo hasta enviar el aviso y después la borra. El aviso llega a través del servicio de notificaciones de tu navegador o de tu móvil (Google, Apple, Mozilla o Microsoft), como en cualquier web con notificaciones.</p>

<h2>Avisos por WhatsApp</h2>
<p>Si eliges «Recibirlo también por WhatsApp», se abre WhatsApp con un mensaje ya escrito que lleva un código, y eres tú quien lo envía al número de Xa Vén. Al recibirlo, el servidor ve tu número de teléfono y tu mensaje. Tu número se guarda solo para mandarte ese aviso (como mucho, unas horas) y se borra en cuanto se envía. Para quitarlo antes, contesta BORRAR. No se usa para nada más y no te escribimos por nuestra cuenta. Si escribes otra cosa a ese número, te contestamos una vez cómo funciona, sin guardar tu número.</p>
<p>WhatsApp es de Meta: los mensajes pasan por sus servidores y Meta los trata según sus propias condiciones, como cualquier conversación de WhatsApp.</p>

<h2>«Voy en este bus»</h2>
<p>Solo si eliges compartir, y solo mientras tienes esa pantalla abierta. Cada 15 segundos se envía qué bus es y por dónde va (el punto, redondeado a unos 10 metros, y la precisión del GPS). Con eso se calcula si va con retraso y quien espera lo ve en directo.</p>
<p>No se guarda tu posición ni nada que te identifique. El retraso de ese bus se olvida a los 2 minutos. De cada salida se guarda un solo número por día (cuánto se retrasó, juntando a todas las personas que la compartieron) durante 60 días, para poder decir «suele ir 3 min tarde». Para frenar abusos, tu dirección IP se mezcla con una clave que cambia cada día y no se guarda.</p>
<p>Puedes dejar de compartir en cualquier momento con «Dejar de compartir».</p>

<h2>«¿Algo no cuadra?»</h2>
<p>Si nos escribes para avisar de un error, se guarda lo que pones (qué pasa, tu texto y, solo si lo dejas, tu correo o teléfono) y lo que estabas mirando en la web (la parada, la línea o el bus, y la hora que marcaba). No se guarda tu dirección IP. Solo lo usamos para corregir los datos y, si dejaste contacto, para contestarte. Se borra cuando está resuelto y, como mucho, a los 180 días.</p>

<h2>El mapa y la búsqueda de sitios</h2>
<p>El mapa se descarga de OpenFreeMap. Cuando escribes un sitio en «Cómo llegar», ese texto se envía al buscador Photon, de Komoot, para encontrarlo. Como pasa con cualquier web, esos servicios reciben tu dirección IP al pedirles algo; no se les envía tu ubicación.</p>

<h2>Registros del servidor</h2>
<p>Como cualquier web, el servidor que da paso a Xa Vén anota de forma técnica las peticiones que recibe (dirección IP, página pedida y hora) para funcionar y defenderse de ataques. Esos registros no se usan para nada más y se borran periódicamente.</p>

<h2>Quién está detrás</h2>
<p>Xa Vén es un proyecto personal de Marco Gugliandolo López, sin relación con la empresa que lleva los buses ni con el Concello de Lugo. Lo que activas tú (ubicación, avisos, WhatsApp, compartir y mensajes) se hace con tu permiso y lo puedes retirar cuando quieras. Los registros técnicos se guardan por el interés en mantener la web funcionando y segura. No se vende ni se cede ningún dato a nadie.</p>

<h2>Tus derechos</h2>
<p>Puedes pedir ver, corregir o borrar tus datos, u oponerte a que se usen, escribiendo desde <a href="/demo/#reportar">«¿Algo no cuadra?»</a> (elige «Otra cosa»). Como Xa Vén no sabe quién eres, casi siempre basta con borrar los datos del sitio en el navegador o quitar los permisos. Si crees que no se han respetado tus derechos, puedes reclamar ante la <a href="https://www.aepd.es/">Agencia Española de Protección de Datos</a>.</p>

<p class="note">Actualizado el ${UPDATED.es}. <a href="/privacidade/">Ler en galego</a></p>
</article>`;

const gl = `<article class="prose">
<h1>Privacidade</h1>
<p class="sub">Xa Vén non che pide conta, non usa cookies e non leva publicidade nin programas que sigan o que fas. Aquí tes, punto por punto, que pasa cos teus datos.</p>

<div class="summary"><ul>
<li>Non fai falta rexistrarse: Xa Vén non sabe quen es.</li>
<li>Non hai cookies de seguimento, nin analítica, nin publicidade.</li>
<li>A túa localización úsase no teu móbil e non se garda en ningún sitio.</li>
<li>Só sae do teu móbil o que ti decides enviar: un aviso da campá, un aviso por WhatsApp, por onde vai o bus se compartes «Vou neste bus» ou unha mensaxe de «Algo non cadra?».</li>
</ul></div>

<h2>O que queda no teu móbil</h2>
<p>As túas paradas gardadas, o idioma, o modo claro ou escuro, a letra grande, os avisos que tes postos e se queres compartir «Vou neste bus» gárdanse no teu propio navegador. Non son cookies de seguimento e non saen do móbil. Tamén se garda unha copia da web para que abra sen cobertura. Para borralo todo, borra os datos deste sitio nos axustes do navegador.</p>

<h2>A túa localización</h2>
<p>Só se dás permiso. Úsase no teu móbil para atopar a parada máis próxima, para «Como chegar a un sitio» e, cando vas no bus, para saber por onde vas e avisarte antes de baixar. Non se envía a Xa Vén nin se garda, agás o que se explica en «Vou neste bus». Podes quitar o permiso cando queiras nos axustes do navegador.</p>

<h2>Os avisos da campá</h2>
<p>Para avisarte aínda que teñas a web pechada, o teu navegador crea un enderezo de avisos anónimo (non leva o teu número nin o teu nome) e mándao ao servidor de Xa Vén coa hora do aviso e o seu texto, por exemplo «Liña 5: chega en 5 min». O servidor gárdao só ata enviar o aviso e despois bórrao. O aviso chega a través do servizo de notificacións do teu navegador ou do teu móbil (Google, Apple, Mozilla ou Microsoft), coma en calquera web con notificacións.</p>

<h2>Avisos por WhatsApp</h2>
<p>Se escolles «Recibilo tamén por WhatsApp», ábrese WhatsApp cunha mensaxe xa escrita que leva un código, e es ti quen a envía ao número de Xa Vén. Ao recibila, o servidor ve o teu número de teléfono e a túa mensaxe. O teu número gárdase só para mandarche ese aviso (como moito, unhas horas) e bórrase en canto se envía. Para quitalo antes, contesta BORRAR. Non se usa para nada máis e non che escribimos pola nosa conta. Se escribes outra cousa a ese número, contestámosche unha vez como funciona, sen gardar o teu número.</p>
<p>WhatsApp é de Meta: as mensaxes pasan polos seus servidores e Meta trátaas segundo as súas propias condicións, coma calquera conversa de WhatsApp.</p>

<h2>«Vou neste bus»</h2>
<p>Só se escolles compartir, e só mentres tes esa pantalla aberta. Cada 15 segundos envíase que bus é e por onde vai (o punto, arredondado a uns 10 metros, e a precisión do GPS). Con iso calcúlase se vai con atraso e quen agarda veo en directo.</p>
<p>Non se garda a túa posición nin nada que te identifique. O atraso dese bus esquécese aos 2 minutos. De cada saída gárdase un só número por día (canto se atrasou, xuntando a todas as persoas que a compartiron) durante 60 días, para poder dicir «adoita ir 3 min tarde». Para frear abusos, o teu enderezo IP mestúrase cunha clave que cambia cada día e non se garda.</p>
<p>Podes deixar de compartir en calquera momento con «Deixar de compartir».</p>

<h2>«Algo non cadra?»</h2>
<p>Se nos escribes para avisar dun erro, gárdase o que pos (que pasa, o teu texto e, só se o deixas, o teu correo ou teléfono) e o que estabas mirando na web (a parada, a liña ou o bus, e a hora que marcaba). Non se garda o teu enderezo IP. Só o usamos para corrixir os datos e, se deixaches contacto, para contestarche. Bórrase cando está resolto e, como moito, aos 180 días.</p>

<h2>O mapa e a busca de sitios</h2>
<p>O mapa descárgase de OpenFreeMap. Cando escribes un sitio en «Como chegar», ese texto envíase ao buscador Photon, de Komoot, para atopalo. Como pasa con calquera web, eses servizos reciben o teu enderezo IP ao pedirlles algo; non se lles envía a túa localización.</p>

<h2>Rexistros do servidor</h2>
<p>Coma calquera web, o servidor que dá paso a Xa Vén anota de forma técnica as peticións que recibe (enderezo IP, páxina pedida e hora) para funcionar e defenderse de ataques. Eses rexistros non se usan para nada máis e bórranse periodicamente.</p>

<h2>Quen está detrás</h2>
<p>Xa Vén é un proxecto persoal de Marco Gugliandolo López, sen relación coa empresa que leva os buses nin co Concello de Lugo. O que activas ti (localización, avisos, WhatsApp, compartir e mensaxes) faise co teu permiso e podes retiralo cando queiras. Os rexistros técnicos gárdanse polo interese en manter a web funcionando e segura. Non se vende nin se cede ningún dato a ninguén.</p>

<h2>Os teus dereitos</h2>
<p>Podes pedir ver, corrixir ou borrar os teus datos, ou opoñerte a que se usen, escribindo desde <a href="/demo/#reportar">«Algo non cadra?»</a> (escolle «Outra cousa»). Como Xa Vén non sabe quen es, case sempre abonda con borrar os datos do sitio no navegador ou quitar os permisos. Se cres que non se respectaron os teus dereitos, podes reclamar ante a <a href="https://www.aepd.es/">Axencia Española de Protección de Datos</a>.</p>

<p class="note">Actualizado o ${UPDATED.gl}. <a href="/privacidad/">Leer en castellano</a></p>
</article>`;

export const PRIVACY = {
  es: { title: 'Privacidad · Xa Vén', description: 'Qué datos usa Xa Vén, la web de los buses urbanos de Lugo: sin cuenta, sin cookies de seguimiento y sin publicidad.', body: es },
  gl: { title: 'Privacidade · Xa Vén', description: 'Que datos usa Xa Vén, a web dos buses urbanos de Lugo: sen conta, sen cookies de seguimento e sen publicidade.', body: gl },
};
