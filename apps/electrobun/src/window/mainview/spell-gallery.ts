import { Container, Graphics } from "pixi.js";

import { getCellPosition } from "@/game/datacenter/cell";

import { Engine } from "@/game/render/engine";
import { SpellVelloRenderer } from "@/game/render/spell-vello-renderer";
import { initVello } from "@/game/render/vello-loader";
import { Scene } from "@/game/scene/scene";
import { SpellRenderer } from "@/game/scene/fight/spell-view";

import ids from "./spell-gallery-ids.json";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const CASTER = 150;
const TARGET = 195;

async function main() {
  const { gpu, renderer: vello } = await initVello();
  const engine = new Engine({
    container: $("stage"),
    backgroundColor: 0x333333,
    gpu,
  } as never);
  engine.setGpu(gpu);
  await engine.init();
  const app = engine.getApp();
  const scene = new Scene();
  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(world);
  const applyZoom = () => world.scale.set(engine.getZoom());
  applyZoom();
  window.addEventListener("resize", () => setTimeout(applyZoom, 400));
  const marks = new Graphics();
  for (const [c, col] of [
    [CASTER, 0x00ff00],
    [TARGET, 0xff0000],
  ] as const) {
    const p = getCellPosition(c, 15, 7);
    marks.circle(p.x, p.y, 6).fill(col);
  }
  marks.zIndex = 1e6;
  world.addChild(marks);
  app.ticker.add((t) => scene.tick(t.deltaMS));

  const spellVello = new SpellVelloRenderer(
    app.renderer,
    "/assets/spritesheets"
  );
  spellVello.setVelloRenderer(vello);
  const renderer = new SpellRenderer(world, scene, {
    mapWidth: 15,
    groundLevel: 7,
    velloRenderer: spellVello,
  });

  let idx = 0;
  const play = async () => {
    const gfx = ids[idx] as number;
    $("gfx").textContent = String(gfx);
    $("st").textContent = "lecture…";
    try {
      await renderer.playSpell({
        spellId: gfx,
        casterCellId: CASTER,
        targetCellId: TARGET,
        spellLevel: 1,
      });
      $("st").textContent = "fini";
    } catch (e) {
      $("st").textContent = `erreur: ${e}`;
    }
    if (($("auto") as HTMLInputElement).checked) {
      idx = (idx + 1) % ids.length;
      setTimeout(play, 600);
    }
  };
  const move = (d: number) => {
    idx = (idx + d + ids.length) % ids.length;
    void play();
  };
  $("prev").onclick = () => move(-1);
  $("next").onclick = () => move(1);
  $("replay").onclick = () => void play();
  $("go").onclick = () => {
    const n = Number(($("goto") as HTMLInputElement).value);
    const i = ids.indexOf(n);
    if (i < 0) {
      $("st").textContent = `${n}: pas de dofasset`;
      return;
    }
    idx = i;
    void play();
  };
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "ArrowRight") move(1);
    if (e.key === "ArrowLeft") move(-1);
  });
  void play();
}

main().catch((e) => {
  $("st").textContent = String(e);
  console.error(e);
});
