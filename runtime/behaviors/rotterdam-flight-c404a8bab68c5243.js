export default async function install(app) {
  const view = app.view;
  app.assert(view?.type === '3d', 'Flight controls require a 3D scene.');
  const [GraphicsLayer, Graphic, Point] = await Promise.all([app.import('esri/layers/GraphicsLayer'), app.import('esri/Graphic'), app.import('esri/geometry/Point')]);
  const mount = app.getMount('flight-deck');
  const mesh=app.layers['1a1cb431917-layer-2'];
  await mesh.load();
  const bounds=mesh.fullExtent;
  const home = {lon:(bounds.xmin+bounds.xmax)/2,lat:bounds.ymin-900/111320,alt:Math.max(400,(bounds.zmax||160)+280)};
  const state = {...home,heading:0,pitch:0,bank:0,throttle:0.38,running:false};
  const keys = new Set(); const deg=Math.PI/180;
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const plane = new GraphicsLayer({id:'flight-aircraft-3d',title:'Flight aircraft (3D)',elevationInfo:{mode:'absolute-height'},listMode:'hide'});
  app.map.add(plane);
  // A complete locally generated glTF airframe, in metres. Design coordinates: right, forward, up.
  const groups=Array.from({length:5},()=>({p:[],n:[]}));
  function triangle(a,b,c,mat){
    const convert=v=>[v[0],v[2],-v[1]];a=convert(a);b=convert(b);c=convert(c);
    const u=b.map((v,i)=>v-a[i]),v=c.map((w,i)=>w-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const d=Math.hypot(...n)||1;
    groups[mat].p.push(...a,...b,...c);for(let i=0;i<3;i++)groups[mat].n.push(...n.map(x=>x/d));
  }
  function quad(a,b,c,d,m){triangle(a,b,c,m);triangle(a,c,d,m);}
  function loft(rings,material,segments=40){
    const point=(r,t)=>[r[3]+r[1]*Math.cos(t),r[0],r[4]+r[2]*Math.sin(t)];
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<segments;i++){
      const t=i*2*Math.PI/segments,t2=(i+1)*2*Math.PI/segments;
      quad(point(rings[j],t),point(rings[j],t2),point(rings[j+1],t2),point(rings[j+1],t),material);
    }
  }
  // Smooth tapered fuselage and pointed nose; dark glazed cockpit follows the upper contour.
  loft([[-6,.03,.04,0,.2],[-5,.22,.3,0,.12],[-3.7,.43,.47,0,0],[-1.5,.66,.68,0,0],[.8,.75,.74,0,0],[2.5,.65,.65,0,0],[3.8,.47,.5,0,0],[4.8,.22,.26,0,0],[5.4,.01,.01,0,0]],0);
  loft([[-.6,.02,.03,0,.57],[0,.46,.3,0,.62],[1,.5,.4,0,.65],[2,.38,.3,0,.62],[2.9,.02,.02,0,.5]],1);
  // Cambered airfoil sections with swept, tapered tips rather than rectangular blocks.
  function wing(sections,side,material){
    const outline=[[0,0],[.08,.075],[.27,.105],[.55,.075],[1,0],[.65,-.025],[.2,-.04]];
    function vertex(s,k){const [f,t]=outline[k];return [s[0]*side,s[1]-f*s[2],s[3]+t*s[2]];}
    for(let j=0;j<sections.length-1;j++)for(let k=0;k<outline.length;k++)quad(vertex(sections[j],k),vertex(sections[j],(k+1)%outline.length),vertex(sections[j+1],(k+1)%outline.length),vertex(sections[j+1],k),j===sections.length-2?3:material);
    const last=sections[sections.length-1];for(let k=1;k<outline.length-1;k++)triangle(vertex(last,0),vertex(last,k),vertex(last,k+1),3);
  }
  for(const side of [-1,1]){
    wing([[.45,1.05,2.4,-.13],[2.5,.45,1.85,.01],[5.8,-.45,1.05,.28],[6.6,-.9,.55,.42]],side,0);
    wing([[.16,-3.8,1.65,.35],[1.8,-4.3,1.05,.52],[2.5,-4.85,.45,.65]],side,0);
    loft([[-.85,.13,.12,side*6.1,.4],[-.6,.17,.14,side*6.1,.4],[-.35,.01,.01,side*6.1,.4]],side<0?2:4,16);
  }
  const finProfile=[[-5.75,.25],[-5.4,2.5],[-4.65,2.8],[-3.5,.35]];
  for(let s of [-1,1])for(let i=1;i<3;i++)triangle([s*.095,...finProfile[0]],[s*.095,...finProfile[i]],[s*.095,...finProfile[i+1]],3);
  for(let i=0;i<4;i++){const a=finProfile[i],b=finProfile[(i+1)%4];quad([-.095,...a],[.095,...a],[.095,...b],[-.095,...b],3);}
  // Long contrasting fuselage stripe, visible from the chase view.
  for(const s of [-1,1])quad([s*.63,-2,.12],[s*.72,.7,.12],[s*.70,.7,-.03],[s*.60,-2,-.03],3);
  const accessors=[],bufferViews=[],chunks=[];let bytes=0;
  function attribute(values){const arr=new Float32Array(values),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i++){const k=i%3;min[k]=Math.min(min[k],values[i]);max[k]=Math.max(max[k],values[i]);}const bi=bufferViews.length;bufferViews.push({buffer:0,byteOffset:bytes,byteLength:arr.byteLength,target:34962});bytes+=arr.byteLength;chunks.push(new Uint8Array(arr.buffer));const ai=accessors.length;accessors.push({bufferView:bi,componentType:5126,count:values.length/3,type:'VEC3',min,max});return ai;}
  const primitives=groups.map((g,i)=>({attributes:{POSITION:attribute(g.p),NORMAL:attribute(g.n)},material:i,mode:4}));
  const raw=new Uint8Array(bytes);let cursor=0;for(const c of chunks){raw.set(c,cursor);cursor+=c.length;}
  let binary='';for(let i=0;i<raw.length;i+=8192)binary+=String.fromCharCode(...raw.subarray(i,i+8192));
  const colors=[[.87,.91,.95,1],[.045,.12,.2,1],[.95,.06,.04,1],[.03,.43,.55,1],[.06,.85,.25,1]];
  const gltf={asset:{version:'2.0',generator:'Nova procedural sport aircraft'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives}],materials:colors.map((c,i)=>({doubleSided:true,pbrMetallicRoughness:{baseColorFactor:c,metallicFactor:i===1?.65:.22,roughnessFactor:i===1?.16:.4}})),buffers:[{byteLength:bytes,uri:'data:application/octet-stream;base64,'+btoa(binary)}],bufferViews,accessors};
  const modelUrl=URL.createObjectURL(new Blob([JSON.stringify(gltf)],{type:'model/gltf+json'}));
  app.onCleanup(()=>URL.revokeObjectURL(modelUrl));
  const airframe=new Graphic({geometry:new Point({longitude:state.lon,latitude:state.lat,z:state.alt,spatialReference:{wkid:4326}}),symbol:{type:'point-3d',symbolLayers:[{type:'object',resource:{href:modelUrl},anchor:'relative',anchorPosition:{x:0,y:0,z:0},castShadows:true}]},attributes:{name:'Swept-wing sport aircraft',triangles:groups.reduce((sum,g)=>sum+g.p.length/9,0)}});
  plane.add(airframe);
  const wrap=document.createElement('div');wrap.style.cssText='display:grid;gap:10px;min-width:0;color:var(--app-text);font-size:13px;';
  const status=document.createElement('div');status.style.cssText='color:var(--app-text-muted);font-size:12px;';
  const readout=document.createElement('div');readout.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px;border:1px solid var(--app-border);border-radius:var(--app-radius);background:var(--app-surface-raised);font-variant-numeric:tabular-nums;';
  const attitude=document.createElement('div');attitude.style.cssText='position:relative;width:110px;height:110px;margin:0 auto;overflow:hidden;border:2px solid var(--app-border);border-radius:50%;background:var(--app-surface-raised);';attitude.setAttribute('role','img');
  const horizon=document.createElement('div');horizon.style.cssText='position:absolute;inset:-45%;background:linear-gradient(to bottom,var(--app-info) 0 50%,var(--app-surface-raised) 50% 100%);transform-origin:50% 50%;';
  const wings=document.createElement('div');wings.style.cssText='position:absolute;left:23%;right:23%;top:49%;border-top:4px solid var(--app-accent);';attitude.append(horizon,wings);
  const makeButton=text=>{const b=document.createElement('calcite-button');b.textContent=text;b.scale='s';return b;};
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:6px;flex-wrap:wrap;';
  const toggle=makeButton('Start flight'),reset=makeButton('Reset');reset.appearance='outline';actions.append(toggle,reset);
  const instructions=document.createElement('div');instructions.style.cssText='line-height:1.55;color:var(--app-text-muted);border-top:1px solid var(--app-border);padding-top:8px;';
  instructions.textContent='Third-person chase view · A / D bank left / right · W / S pitch down / up · Q / E rudder · R / F throttle. Click Start, then use the keyboard. Space pauses.';
  wrap.append(status,attitude,readout,actions,instructions);mount.replaceChildren(wrap);
  function aircraft(){
    airframe.geometry=new Point({longitude:state.lon,latitude:state.lat,z:state.alt,spatialReference:{wkid:4326}});
    const s=airframe.symbol.clone(),obj=s.symbolLayers.getItemAt(0);obj.heading=state.heading;obj.tilt=state.pitch;obj.roll=state.bank;airframe.symbol=s;
  }
  function camera(){
    const h=state.heading*deg,back=62;
    const next=view.camera.clone();
    next.position=new Point({longitude:state.lon-Math.sin(h)*back/(111320*Math.cos(state.lat*deg)),latitude:state.lat-Math.cos(h)*back/111320,z:state.alt+22,spatialReference:{wkid:4326}});
    next.heading=((state.heading%360)+360)%360;next.tilt=clamp(70+state.pitch*0.35,48,87);view.camera=next;
  }
  function render(){
    status.textContent=state.running?'FLYING · chase view':'PAUSED · chase view ready';
    readout.replaceChildren();
    for(const [name,value] of [['THROTTLE',Math.round(state.throttle*100)+'%'],['AIR SPEED',Math.round(state.throttle*180)+' m/s'],['ALTITUDE',Math.round(state.alt)+' m'],['HEADING',Math.round((state.heading+360)%360)+'°'],['PITCH',Math.round(state.pitch)+'°'],['BANK',Math.round(state.bank)+'°']]){
      const cell=document.createElement('div');cell.style.cssText='display:grid;gap:2px;';
      const label=document.createElement('span');label.textContent=name;label.style.cssText='font-size:10px;color:var(--app-text-muted);letter-spacing:.06em;';
      const number=document.createElement('span');number.textContent=value;number.style.cssText='font-size:16px;';cell.append(label,number);readout.append(cell);
    }
    horizon.style.transform='rotate('+(-state.bank)+'deg) translateY('+(state.pitch*.35)+'px)';attitude.setAttribute('aria-label','Bank '+Math.round(state.bank)+' degrees, pitch '+Math.round(state.pitch)+' degrees');toggle.textContent=state.running?'Pause flight':'Start flight';
  }
  function step(dt,controls=keys){
    const held=k=>controls.has(k);
    state.throttle=clamp(state.throttle+((held('r')?1:0)-(held('f')?1:0))*dt*.28,0,1);
    state.bank=clamp(state.bank+((held('d')?1:0)-(held('a')?1:0))*50*dt,-50,50);
    const pitchInput=(held('s')?1:0)-(held('w')?1:0);
    state.pitch=clamp(state.pitch+pitchInput*27*dt,-40,40);if(!pitchInput)state.pitch*=Math.exp(-.55*dt);
    const yawInput=(held('e')?1:0)-(held('q')?1:0),speed=state.throttle*180;
    state.heading+=(yawInput*23+state.bank*speed/180*.47)*dt;
    const distance=speed*Math.cos(state.pitch*deg)*dt;
    state.lat=clamp(state.lat+Math.cos(state.heading*deg)*distance/111320,-85,85);
    state.lon+=Math.sin(state.heading*deg)*distance/(111320*Math.max(.1,Math.cos(state.lat*deg)));
    state.alt=clamp(state.alt+speed*Math.sin(state.pitch*deg)*dt,60,9000);
    aircraft();camera();render();
    return {longitude:state.lon,latitude:state.lat,altitudeMeters:state.alt,headingDegrees:state.heading,bankDegrees:state.bank,wingRollDegrees:airframe.symbol.symbolLayers.getItemAt(0).roll,planeParts:plane.graphics.length,modelTriangles:airframe.attributes.triangles,distanceToMeshEdgeMeters:(bounds.ymin-state.lat)*111320,meshVisible:app.layers['1a1cb431917-layer-2']?.visible,basemap:app.map.basemap?.title};
  }
  let frame=0,previous=0;
  function loop(t){if(!state.running)return;if(previous)step(Math.min(.06,(t-previous)/1000));previous=t;frame=requestAnimationFrame(loop);}
  function pause(){state.running=false;keys.clear();cancelAnimationFrame(frame);previous=0;render();}
  function start(){if(state.running)return;state.running=true;previous=0;render();frame=requestAnimationFrame(loop);}
  function restore(){pause();Object.assign(state,home,{heading:0,pitch:0,bank:0,throttle:.38});aircraft();camera();render();}
  function keydown(e){if(e.target?.closest?.('input,textarea,select,[contenteditable="true"],calcite-input-text'))return;const k=e.key.toLowerCase();if(k===' '||e.code==='Space'){e.preventDefault();if(!e.repeat)state.running?pause():start();return;}if('wasdqerf'.includes(k)&&k.length===1){e.preventDefault();keys.add(k);}}
  function keyup(e){keys.delete(e.key.toLowerCase());}
  const blur=()=>{keys.clear();previous=0;};const onToggle=()=>state.running?pause():start();
  toggle.addEventListener('click',onToggle);reset.addEventListener('click',restore);
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
  aircraft();camera();render();
  app.actions.register('flight-test-step',({key='r',seconds=.2}={})=>step(clamp(Number(seconds)||.2,.01,.25),new Set([String(key).toLowerCase()])));
  app.actions.register('flight-reset',()=>{restore();return {longitude:state.lon,latitude:state.lat,altitudeMeters:state.alt,headingDegrees:state.heading,distanceToMeshEdgeMeters:(bounds.ymin-state.lat)*111320,planeParts:plane.graphics.length,camera:view.camera.toJSON()};});
  app.actions.register('flight-start',()=>{start();return {running:state.running,headingDegrees:state.heading};});
  app.onCleanup(()=>{pause();toggle.removeEventListener('click',onToggle);reset.removeEventListener('click',restore);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);mount.replaceChildren();});
}