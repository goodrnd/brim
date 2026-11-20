import {useEffect, useRef} from 'react';
import {BufferAttribute, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene, WebGLRenderer} from 'three';
import {tokenColor} from './color.ts';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';

/** Orbitable preview of a triangle soup on a printer bed. Colours come from the design tokens. */
export function Viewer({positions, bed, theme, onSnapshot}: {positions: Float32Array; bed: [number, number]; theme: string; onSnapshot?: (url: string) => void}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{scene: Scene; mesh?: Mesh; grid?: Object3D; camera: PerspectiveCamera; controls: OrbitControls; snap?: boolean}>(null);
  const snapshot = useRef(onSnapshot);
  useEffect(() => {
    snapshot.current = onSnapshot;
  }, [onSnapshot]);
  const [bedX, bedY] = bed;

  useEffect(() => {
    const el = host.current!;
    const renderer = new WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(devicePixelRatio);
    el.append(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new HemisphereLight(0xff_ff_ff, 0x44_44_44, 1.2));
    const sun = new DirectionalLight(0xff_ff_ff, 1.4);
    sun.position.set(1, -1.5, 2);
    scene.add(sun);
    state.current = {scene, camera, controls};
    const resize = () => {
      const {width, height} = el.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
      // Read back in the same frame as the render, so preserveDrawingBuffer is not needed.
      if (state.current?.snap && snapshot.current && el.clientWidth) {
        state.current.snap = false;
        const c = document.createElement('canvas');
        [c.width, c.height] = [320, Math.round((320 * el.clientHeight) / el.clientWidth)];
        c.getContext('2d')!.drawImage(renderer.domElement, 0, 0, c.width, c.height);
        snapshot.current(c.toDataURL('image/webp', 0.8));
      }
    });
    return () => {
      ro.disconnect();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const s = state.current!;
    const token = (name: string, fallback: string) => new Color(tokenColor(name, fallback));
    if (s.mesh) {
      s.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    if (s.grid) {s.scene.remove(s.grid);}
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const color = token('--semantic-color-background-fill-primary', '#3a6ea5');
    s.mesh = new Mesh(geo, new MeshStandardMaterial({color, roughness: 0.55, metalness: 0.05, flatShading: true}));
    s.scene.add(s.mesh);

    const grid = new Group();
    const line = token('--semantic-color-border-secondary', '#ccc');
    const lines: Array<number> = [];
    for (let x = -bedX / 2; x <= bedX / 2; x += 10) {lines.push(x, -bedY / 2, 0, x, bedY / 2, 0);}
    for (let y = -bedY / 2; y <= bedY / 2; y += 10) {lines.push(-bedX / 2, y, 0, bedX / 2, y, 0);}
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(lines, 3));
    grid.add(new LineSegments(lg, new LineBasicMaterial({color: line})));
    s.grid = grid;
    s.scene.add(grid);

    geo.computeBoundingSphere();
    const r = Math.max(geo.boundingSphere!.radius, 20);
    const c = geo.boundingSphere!.center;
    s.controls.target.copy(c);
    s.camera.position.set(c.x + r * 1.8, c.y - r * 2.4, c.z + r * 1.6);
    s.snap = true;
  }, [positions, bedX, bedY, theme]);

  return <div ref={host} className="viewer" />;
}

/** Parses binary or ASCII STL into a triangle soup. */
export function parseStl(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (n > 0 && 84 + n * 50 === buf.byteLength) {
    const out = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {for (let k = 0; k < 9; k++) {out[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);}}
    return out;
  }
  const text = new TextDecoder().decode(buf);
  const nums = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
  if (!nums.length || nums.some(Number.isNaN)) {throw new Error('Not a valid STL file');}
  return new Float32Array(nums);
}
