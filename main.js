import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { clone as clonar } from 'three/addons/utils/SkeletonUtils.js';

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x93a6ae);
escena.fog = new THREE.Fog(0x93a6ae, 65, 170);
const altura = 1.7;
const camara = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 300);
escena.add(camara);
const render = new THREE.WebGLRenderer({ antialias: true });
render.setSize(innerWidth, innerHeight);
render.setPixelRatio(Math.min(devicePixelRatio, 1.5));
render.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(render.domElement);
escena.add(new THREE.HemisphereLight(0xe5f1ff, 0x69614e, 2.5));
const sol = new THREE.DirectionalLight(0xffedd2, 3);
sol.position.set(30, 45, 15);
escena.add(sol);

const controles = new PointerLockControls(camara, document.body);
const reloj = new THREE.Clock();
const cargador = new GLTFLoader();
const rayo = new THREE.Raycaster();
const teclas = {};
const celdas = new Map();
const ladoCelda = 0.5;
let mapa;
const zombis = [];
const cajas = [];
const armas = [
  { nombre: 'M4A1', balas: 12, inicial: 12, modelo: null },
  { nombre: 'AK-47', balas: 8, inicial: 8, modelo: null }
];
const menu = document.querySelector('#menu');
const titulo = document.querySelector('#titulo');
const detalle = document.querySelector('#detalle');
const boton = document.querySelector('#jugar');
let estado = 'cargando';
let arma = 0;
let retroceso = 0;

const salida = new THREE.Mesh(
  new THREE.CylinderGeometry(1.2, 1.2, 0.04, 40),
  new THREE.MeshStandardMaterial({ color: 0x4bdca8, emissive: 0x187a57, emissiveIntensity: 0.8 })
);
escena.add(salida);
const aro = new THREE.Mesh(
  new THREE.TorusGeometry(1.25, 0.05, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xa9ffda })
);
aro.rotation.x = -Math.PI / 2;
escena.add(aro);

function ajustar(modelo, medida, eje = 'y') {
  modelo.updateMatrixWorld(true);
  const caja = new THREE.Box3().setFromObject(modelo);
  const tam = caja.getSize(new THREE.Vector3());
  const escala = medida / (eje === 'mayor' ? Math.max(tam.x, tam.y, tam.z) : tam[eje]);
  modelo.scale.multiplyScalar(escala);
  modelo.updateMatrixWorld(true);
  caja.setFromObject(modelo);
  const centro = caja.getCenter(new THREE.Vector3());
  modelo.position.x -= centro.x;
  modelo.position.z -= centro.z;
  modelo.position.y -= caja.min.y;
  return modelo;
}

function actualizarBalas() {
  document.querySelector('#balas').textContent = armas[arma].balas;
}

function equiparArma(indice) {
  arma = indice;
  armas.forEach((dato, i) => { dato.modelo.visible = i === arma; });
  retroceso = 0;
  actualizarBalas();
}

async function cargarModelos() {
  try {
    const respuesta = await fetch('./recorrido.json');
    if (!respuesta.ok) throw new Error('No se pudo cargar el recorrido.');
    mapa = await respuesta.json();
    const rutas = ['arma1', 'arma2', 'zombie', 'CajaMuniciones', 'HospitalAbandonado'];
    mapa.puntos.forEach((punto, i) => {
      punto.indice = i;
      const clave = claveCelda(punto.x, punto.z);
      if (!celdas.has(clave)) celdas.set(clave, []);
      celdas.get(clave).push(punto);
    });
    const modelos = await Promise.all(
      rutas.map(nombre => cargador.loadAsync(`./models/${nombre}.glb`))
    );
    for (let i = 0; i < 2; i++) {
      const modelo = modelos[i].scene;
      modelo.rotation.y = Math.PI;
      ajustar(modelo, 0.95, 'mayor');
      const grupo = new THREE.Group();
      grupo.add(modelo);
      grupo.position.set(0.25, -0.42, -0.78);
      camara.add(grupo);
      armas[i].modelo = grupo;
    }
    const hospital = ajustar(modelos[4].scene, mapa.escala, 'mayor');
    const puertas = [];
    hospital.traverse(parte => {
      if (/^door/i.test(parte.name)) puertas.push(parte);
    });
    puertas.forEach(puerta => puerta.removeFromParent());
    escena.add(hospital);
    const fin = mapa.puntos[mapa.final];
    salida.position.set(fin.x, fin.y + 0.04, fin.z);
    aro.position.set(fin.x, fin.y + 0.08, fin.z);
    const luzSalida = new THREE.PointLight(0x7affc6, 8, 8);
    luzSalida.position.set(fin.x, fin.y + 1.5, fin.z);
    escena.add(luzSalida);
    const inicio = mapa.puntos[mapa.inicio];
    const marca = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.6, 32),
      new THREE.MeshBasicMaterial({ color: 0xc9dce8, side: THREE.DoubleSide })
    );
    marca.rotation.x = -Math.PI / 2;
    marca.position.set(inicio.x, inicio.y + 0.03, inicio.z);
    escena.add(marca);
    const baseZombi = ajustar(modelos[2].scene, 1.8);
    mapa.zombis.forEach((dato, i) => {
      const punto = mapa.puntos[dato.punto];
      const modelo = new THREE.Group();
      modelo.add(clonar(baseZombi));
      modelo.position.set(punto.x, punto.y, punto.z);
      escena.add(modelo);
      const zombi = { cuerpo: modelo, inicio: punto, velocidad: dato.vel, vida: 2, rango: 12, ruta: [], espera: i * 0.1 };
      modelo.traverse(parte => {
        if (parte.isMesh) parte.userData.zombi = zombi;
      });
      zombis.push(zombi);
    });
    const baseCaja = ajustar(modelos[3].scene, 0.95, 'mayor');
    for (const indice of mapa.cajas) {
      const punto = mapa.puntos[indice];
      const modelo = new THREE.Group();
      modelo.add(clonar(baseCaja));
      modelo.position.set(punto.x, punto.y + 0.03, punto.z);
      escena.add(modelo);
      cajas.push({ cuerpo: modelo, recogida: false });
    }
    estado = 'listo';
    reiniciar();
    document.querySelector('#mira').hidden = false;
    document.querySelector('#balas').hidden = false;
    mostrarMenu('listo', 'Iniciar misión');
    boton.disabled = false;
  } catch (error) {
    estado = 'error';
    mostrarMenu('error', 'No se pudo cargar el juego');
    boton.disabled = false;
    console.error(error);
  }
}

function claveCelda(x, z) {
  return `${Math.round(x / ladoCelda)},${Math.round(z / ladoCelda)}`;
}

function celdaEn(x, z, y) {
  const opciones = celdas.get(claveCelda(x, z)) || [];
  let elegida = null;
  for (const punto of opciones) {
    if (Math.abs(punto.y - y) > 0.65) continue;
    if (!elegida || Math.abs(punto.y - y) < Math.abs(elegida.y - y)) elegida = punto;
  }
  return elegida;
}

function conectadas(origen, destino) {
  if (!origen || !destino) return false;
  if (origen === destino || origen.vecinos.includes(destino.indice)) return true;
  if (Math.abs(origen.x - destino.x) > ladoCelda + 0.01
    || Math.abs(origen.z - destino.z) > ladoCelda + 0.01) return false;
  const pasoX = celdaEn(destino.x, origen.z, origen.y);
  const pasoZ = celdaEn(origen.x, destino.z, origen.y);
  return [pasoX, pasoZ].every(punto => punto
    && origen.vecinos.includes(punto.indice)
    && punto.vecinos.includes(destino.indice));
}

function sueloEn(x, z, alturaPie) {
  return celdaEn(x, z, alturaPie)?.y ?? null;
}

function intentarPaso(posicion, dx, dz) {
  const origen = celdaEn(posicion.x, posicion.z, posicion.y);
  const destino = celdaEn(posicion.x + dx, posicion.z + dz, posicion.y);
  if (!conectadas(origen, destino)) return false;
  posicion.set(posicion.x + dx, destino.y, posicion.z + dz);
  return true;
}

function mover(posicion, dx, dz) {
  if (intentarPaso(posicion, dx, dz)) return;
  intentarPaso(posicion, dx, 0);
  intentarPaso(posicion, 0, dz);
}

function golpePared(rayo, limite) {
  let anterior = celdaEn(rayo.origin.x, rayo.origin.z, rayo.origin.y - 1.2);
  if (!anterior) anterior = celdaEn(rayo.origin.x, rayo.origin.z, rayo.origin.y - altura);
  if (!anterior) return { distance: 0 };
  const pos = new THREE.Vector3();
  const pasos = Math.max(1, Math.ceil(limite / 0.1));
  for (let i = 1; i <= pasos; i++) {
    const distancia = limite * i / pasos;
    rayo.at(distancia, pos);
    if (pos.y > anterior.y + 2.4) return null;
    const actual = celdaEn(pos.x, pos.z, anterior.y);
    if (!conectadas(anterior, actual) || pos.y < actual.y + 0.02) return { distance: distancia };
    anterior = actual;
  }
  return null;
}

function puntoCercano(posicion) {
  let indice = 0;
  let menor = Infinity;
  mapa.puntos.forEach((punto, i) => {
    const distancia = (punto.x - posicion.x) ** 2 + (punto.y - posicion.y) ** 2 + (punto.z - posicion.z) ** 2;
    if (distancia < menor) { menor = distancia; indice = i; }
  });
  return indice;
}

function buscarRuta(inicio, final) {
  const origen = puntoCercano(inicio);
  const destino = puntoCercano(final);
  const cola = [origen];
  const previos = new Map([[origen, null]]);
  for (let i = 0; i < cola.length; i++) {
    const actual = cola[i];
    if (actual === destino) {
      const ruta = [];
      let paso = actual;
      while (paso !== null) {
        ruta.unshift(mapa.puntos[paso]);
        paso = previos.get(paso);
      }
      return ruta.slice(1);
    }
    for (const vecino of mapa.puntos[actual].vecinos) {
      if (previos.has(vecino)) continue;
      previos.set(vecino, actual);
      cola.push(vecino);
    }
  }
  return [];
}

function visibleEntre(inicio, final) {
  const direccion = new THREE.Vector3().subVectors(final, inicio);
  const distancia = direccion.length();
  const golpe = golpePared(new THREE.Ray(inicio, direccion.normalize()), distancia);
  return !golpe || golpe.distance > distancia - 0.1;
}

function actualizarJugador(delta) {
  const frente = Number(!!teclas.KeyW) - Number(!!teclas.KeyS);
  const lado = Number(!!teclas.KeyD) - Number(!!teclas.KeyA);
  const largo = Math.hypot(frente, lado);
  if (!largo) return;
  const antes = camara.position.clone();
  controles.moveForward(frente / largo * 3.8 * delta);
  controles.moveRight(lado / largo * 3.8 * delta);
  const dx = camara.position.x - antes.x;
  const dz = camara.position.z - antes.z;
  antes.y -= altura;
  mover(antes, dx, dz);
  camara.position.copy(antes);
  camara.position.y += altura;
}

function actualizarZombis(delta) {
  const pie = camara.position.clone();
  pie.y -= altura;
  for (const zombi of zombis) {
    if (zombi.vida === 0) continue;
    const pos = zombi.cuerpo.position;
    const distancia = pie.distanceTo(pos);
    const vista = pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    if (distancia < 0.8 && visibleEntre(vista, camara.position)) {
      terminar(false);
      return;
    }
    if (distancia > zombi.rango) continue;
    zombi.espera -= delta;
    if (zombi.espera <= 0) {
      zombi.ruta = buscarRuta(pos, pie);
      zombi.espera = 0.8;
    }
    const directo = distancia < 1.5 && visibleEntre(vista, camara.position);
    const destino = directo ? pie : zombi.ruta[0];
    if (!destino) continue;
    const dx = destino.x - pos.x;
    const dz = destino.z - pos.z;
    const largo = Math.hypot(dx, dz);
    if (largo < 0.12) zombi.ruta.shift();
    else {
      const paso = Math.min(zombi.velocidad * delta, largo);
      mover(pos, dx / largo * paso, dz / largo * paso);
      zombi.cuerpo.lookAt(destino.x, pos.y, destino.z);
    }
  }
}

function recogerCajas() {
  for (const caja of cajas) {
    if (caja.recogida) continue;
    const pos = caja.cuerpo.position;
    if (Math.hypot(pos.x - camara.position.x, pos.z - camara.position.z) < 1.2
      && Math.abs(pos.y + altura - camara.position.y) < 0.7
      && visibleEntre(camara.position, pos.clone().add(new THREE.Vector3(0, 0.4, 0)))) {
      caja.recogida = true;
      caja.cuerpo.visible = false;
      armas[0].balas += 6;
      armas[1].balas += 4;
      actualizarBalas();
    }
  }
}

function disparar() {
  if (estado !== 'jugando' || !controles.isLocked) return;
  if (armas[arma].balas === 0) return;
  armas[arma].balas--;
  retroceso = 0.1;
  escena.updateMatrixWorld(true);
  rayo.setFromCamera(new THREE.Vector2(0, 0), camara);
  const blancos = zombis.filter(zombi => zombi.vida > 0).map(zombi => zombi.cuerpo);
  const impactos = rayo.intersectObjects(blancos, true);
  const muro = golpePared(rayo.ray, impactos[0]?.distance ?? 40);
  if (impactos.length && (!muro || impactos[0].distance < muro.distance)) {
    const zombi = impactos[0].object.userData.zombi;
    if (zombi) {
      zombi.vida--;
      if (zombi.vida === 0) {
        zombi.cuerpo.visible = false;
      }
    }
  }
  actualizarBalas();
}

function reiniciar() {
  const inicio = mapa.puntos[mapa.inicio];
  const frente = mapa.puntos[mapa.principal[8]];
  camara.position.set(inicio.x, inicio.y + altura, inicio.z);
  camara.lookAt(frente.x, frente.y + altura, frente.z);
  retroceso = 0;
  Object.keys(teclas).forEach(tecla => { teclas[tecla] = false; });
  armas.forEach(dato => { dato.balas = dato.inicial; });
  zombis.forEach(zombi => {
    zombi.vida = 2;
    zombi.cuerpo.position.set(zombi.inicio.x, zombi.inicio.y, zombi.inicio.z);
    zombi.cuerpo.rotation.set(0, 0, 0);
    zombi.cuerpo.visible = true;
    zombi.ruta = [];
    zombi.espera = 0;
  });
  cajas.forEach(caja => {
    caja.recogida = false;
    caja.cuerpo.visible = true;
  });
  equiparArma(0);
}

function mostrarMenu(tipo, mensaje, texto = '') {
  menu.dataset.estado = tipo;
  menu.hidden = false;
  titulo.textContent = mensaje;
  detalle.textContent = texto;
  detalle.hidden = texto === '';
}

function terminar(victoria) {
  estado = victoria ? 'victoria' : 'derrota';
  controles.unlock();
  mostrarMenu(estado, victoria ? '¡MISIÓN COMPLETADA!' : 'GAME OVER',
    victoria ? 'Has llegado a la zona de extracción' : '');
}

boton.addEventListener('click', () => {
  if (estado === 'error') { location.reload(); return; }
  if (estado === 'cargando') return;
  if (estado === 'victoria' || estado === 'derrota') reiniciar();
  controles.lock();
});
controles.addEventListener('lock', () => {
  estado = 'jugando';
  menu.hidden = true;
  reloj.getDelta();
});
controles.addEventListener('unlock', () => {
  Object.keys(teclas).forEach(tecla => { teclas[tecla] = false; });
  if (estado !== 'jugando') return;
  estado = 'pausa';
  mostrarMenu('pausa', 'PAUSA');
});
document.addEventListener('pointerlockerror', () => {
  console.error('No se pudo capturar el mouse.');
});
window.addEventListener('keydown', evento => {
  if (estado !== 'jugando') return;
  teclas[evento.code] = true;
  if (evento.code === 'Digit1') equiparArma(0);
  if (evento.code === 'Digit2') equiparArma(1);
});
window.addEventListener('keyup', evento => { teclas[evento.code] = false; });
window.addEventListener('blur', () => {
  Object.keys(teclas).forEach(tecla => { teclas[tecla] = false; });
  if (controles.isLocked) controles.unlock();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && controles.isLocked) controles.unlock();
});
window.addEventListener('mousedown', evento => {
  if (evento.button === 0) disparar();
});

function animar() {
  requestAnimationFrame(animar);
  const delta = Math.min(reloj.getDelta(), 0.04);
  if (estado === 'jugando' && controles.isLocked) {
    actualizarJugador(delta);
    actualizarZombis(delta);
    if (estado === 'jugando') {
      recogerCajas();
      const fin = mapa.puntos[mapa.final];
      const distancia = Math.hypot(camara.position.x - fin.x, camara.position.z - fin.z);
      if (distancia < 1.2 && Math.abs(camara.position.y - altura - fin.y) < 0.5) terminar(true);
    }
    retroceso = Math.max(0, retroceso - delta * 0.65);
    armas[arma].modelo.position.z = -0.78 + retroceso;
    armas[arma].modelo.rotation.x = retroceso * 0.6;
  }
  if (estado !== 'cargando') render.render(escena, camara);
}
window.addEventListener('resize', () => {
  camara.aspect = innerWidth / innerHeight;
  camara.updateProjectionMatrix();
  render.setSize(innerWidth, innerHeight);
});
animar();
cargarModelos();
