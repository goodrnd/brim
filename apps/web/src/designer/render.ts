import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import {tokenColor} from '../lib/color.ts';

/** Renders meshes to webp data URLs with one throwaway renderer, so a gallery costs one WebGL context, not one per card. */
export function renderThumbs(meshes: Array<Float32Array>, w = 320, h = 240): Array<string> {
  const renderer = new WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
  renderer.setSize(w, h, false);
  const color = new Color(tokenColor('--semantic-color-background-fill-primary', '#3a6ea5'));
  const urls = meshes.map((positions) => {
    const scene = new Scene();
    scene.add(new HemisphereLight(0xff_ff_ff, 0x44_44_44, 1.2));
    const sun = new DirectionalLight(0xff_ff_ff, 1.4);
    sun.position.set(1, -1.5, 2);
    scene.add(sun);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const material = new MeshStandardMaterial({color, roughness: 0.55, metalness: 0.05, flatShading: true});
    scene.add(new Mesh(geo, material));
    const {center: c, radius: r} = geo.boundingSphere!;
    const camera = new PerspectiveCamera(32, w / h, 1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(c.x + r * 1.8, c.y - r * 2.4, c.z + r * 1.6);
    camera.lookAt(c);
    renderer.render(scene, camera);
    geo.dispose();
    material.dispose();
    return renderer.domElement.toDataURL('image/webp', 0.85);
  });
  renderer.dispose();
  renderer.forceContextLoss();
  return urls;
}
