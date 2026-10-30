import { POKEMON, REGIONS } from './data/pokemon.js';

const INVENTORY_KEY = 'cardbuddy.virtual.v1';
const BINDERS_KEY = 'cardbuddy.virtual.binders.v1';
const $ = (id) => document.getElementById(id);
const parse = (value, fallback) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
const uid = () => globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
const newPage = () => ({ id: uid(), slots: Array(9).fill(null) });
let binders = parse(localStorage.getItem(BINDERS_KEY), []);
let activeId = binders[0]?.id || null;
let pageIndex = 0;
let dragged = null;
let edgeTimer = null;
let touchStartX = null;
let pickerSlot = null;

function inventoryState() { return parse(localStorage.getItem(INVENTORY_KEY), { inventory: [], unlockedPokemon: [] }); }
function inventory() { return inventoryState().inventory || []; }
function activeBinder() { return binders.find((binder) => binder.id === activeId) || null; }
function persist() { localStorage.setItem(BINDERS_KEY, JSON.stringify(binders)); renderBinder(); }
function ensureBinder() {
  if (!binders.length) binders = [{ id: uid(), name: 'My Virtual Binder', pages: [newPage()] }];
  if (!binders.some((binder) => binder.id === activeId)) activeId = binders[0].id;
  for (const binder of binders) {
    if (!Array.isArray(binder.pages) || !binder.pages.length) binder.pages = [newPage()];
    for (const page of binder.pages) {
      if (!Array.isArray(page.slots)) page.slots = Array(9).fill(null);
      while (page.slots.length < 9) page.slots.push(null);
      page.slots = page.slots.slice(0,9);
    }
  }
  localStorage.setItem(BINDERS_KEY, JSON.stringify(binders));
}
function cardById(id) { return inventory().find((card) => card.id === id) || null; }
function showCard(card) {
  if (!card) return;
  const root = $('virtualCardDetailContent');
  root.replaceChildren();
  const img = document.createElement('img'); img.src = card.image; img.alt = card.name + ' trading card';
  const title = document.createElement('h3'); title.textContent = card.name;
  const rarity = document.createElement('p'); rarity.textContent = card.rarity + (card.setName ? ' · ' + card.setName : '');
  root.append(img,title,rarity);
  $('virtualCardDetail').showModal();
}
function renderBinder() {
  ensureBinder();
  const binder = activeBinder();
  const inventoryCards = inventory();
  $('virtualBinderSelect').replaceChildren(...binders.map((item) => new Option(item.name,item.id)));
  $('virtualBinderSelect').value = activeId;
  $('virtualBinderName').textContent = binder.name;
  pageIndex = Math.max(0,Math.min(pageIndex,binder.pages.length-1));
  $('virtualBinderPageCount').textContent = 'Page ' + (pageIndex+1) + ' of ' + binder.pages.length;
  $('virtualBinderStats').textContent = inventoryCards.length + ' cards in virtual inventory · ' + new Set(inventoryCards.map((card) => card.pokemonId).filter(Boolean)).size + ' Pokémon discovered';
  $('virtualBinderPageJump').replaceChildren(...binder.pages.map((page,index) => new Option('Page '+(index+1),String(index))));
  $('virtualBinderPageJump').value = String(pageIndex);
  $('virtualBinderPages').replaceChildren(...binder.pages[pageIndex].slots.map((cardId,index) => makeSlot(cardId,index)));
  $('virtualPrevPage').disabled = pageIndex === 0;
  $('virtualNextPage').disabled = pageIndex === binder.pages.length-1;
  $('virtualRemovePage').disabled = binder.pages.length <= 1;
}
function makeSlot(cardId,index) {
  const card = cardId ? cardById(cardId) : null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'binder-slot' + (card ? ' virtual-filled-slot rarity-border-'+card.rarityIndex : '');
  button.dataset.slot = String(index);
  if (card) {
    const img = document.createElement('img'); img.src = card.image; img.alt = card.name; img.loading = 'lazy';
    img.onerror = () => { img.onerror = null; img.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+(card.dexNumber || 25)+'.png'; };
    const caption = document.createElement('span'); caption.className = 'slot-caption'; caption.textContent = card.name;
    button.append(img,caption);
    const remove = document.createElement('span'); remove.className = 'slot-remove'; remove.textContent = '×'; remove.setAttribute('aria-label','Remove from binder');
    remove.addEventListener('click',(event) => { event.stopPropagation(); const binder=activeBinder(); binder.pages[pageIndex].slots[index]=null; persist(); });
    button.append(remove);
  } else {
    const plus = document.createElement('span'); plus.className='slot-plus'; plus.textContent='+';
    const label = document.createElement('span'); label.textContent='Add card';
    button.append(plus,label);
  }
  button.addEventListener('click',() => card ? showCard(card) : openPicker(index));
  button.draggable = Boolean(card);
  button.addEventListener('dragstart',(event) => {
    dragged={pageIndex,slotIndex:index};
    event.dataTransfer.setData('text/plain',JSON.stringify(dragged));
    event.dataTransfer.effectAllowed='move';
    $('virtualBinderBook').classList.add('is-dragging');
  });
  button.addEventListener('dragend',() => {
    dragged=null; clearTimeout(edgeTimer); edgeTimer=null;
    $('virtualBinderBook').classList.remove('is-dragging');
    document.querySelectorAll('#virtualBinderBook .binder-drop-edge').forEach((edge)=>edge.classList.remove('edge-active'));
  });
  button.addEventListener('dragover',(event)=>{event.preventDefault();button.classList.add('drop-target');});
  button.addEventListener('dragleave',()=>button.classList.remove('drop-target'));
  button.addEventListener('drop',(event)=>{
    event.preventDefault();button.classList.remove('drop-target');
    let source; try{source=JSON.parse(event.dataTransfer.getData('text/plain'));}catch{return;}
    moveSlot(source,{pageIndex,slotIndex:index});
  });
  return button;
}
function moveSlot(source,target) {
  if (!source || source.pageIndex===target.pageIndex && source.slotIndex===target.slotIndex) return;
  const binder=activeBinder();
  const from=binder.pages[source.pageIndex]?.slots, to=binder.pages[target.pageIndex]?.slots;
  if (!from || !to || !from[source.slotIndex]) return;
  [from[source.slotIndex],to[target.slotIndex]]=[to[target.slotIndex],from[source.slotIndex]];
  persist();
}
function openPicker(index) {
  pickerSlot=index;
  const root=$('virtualBinderPickerCards');
  const cards=inventory();
  if (!cards.length) {
    const note=document.createElement('p');note.textContent='Open a virtual pack first. Your pulled cards will appear here.';root.replaceChildren(note);
  } else {
    root.replaceChildren(...cards.map((card)=>{
      const button=document.createElement('button');button.type='button';button.className='virtual-picker-card';
      const image=document.createElement('img');image.src=card.image;image.alt='';
      const title=document.createElement('strong');title.textContent=card.name;
      const rarity=document.createElement('small');rarity.textContent=card.rarity;
      button.append(image,title,rarity);
      button.addEventListener('click',()=>{
        const binder=activeBinder();binder.pages[pageIndex].slots[pickerSlot]=card.id;
        $('virtualBinderPicker').close();persist();
      });
      return button;
    }));
  }
  $('virtualBinderPicker').showModal();
}
async function turnPage(delta) {
  const binder=activeBinder(),next=pageIndex+delta;
  if(next<0||next>=binder.pages.length)return;
  const book=$('virtualBinderBook');book.classList.add(delta>0?'turn-forward':'turn-back');
  await new Promise(resolve=>setTimeout(resolve,360));
  pageIndex=next;renderBinder();book.classList.remove('turn-forward','turn-back');
}
function renderPokedex() {
  const unlocked=new Set(inventoryState().unlockedPokemon || []);
  const region=$('virtualPokedexRegion').value || REGIONS[0];
  const query=$('virtualPokedexSearch').value.trim().toLowerCase();
  const entries=POKEMON.filter((pokemon)=>pokemon.region===region);
  const found=entries.filter((pokemon)=>unlocked.has(pokemon.id));
  $('virtualPokedexProgress').textContent=found.length+' / '+entries.length+' discovered in '+region+' · '+unlocked.size+' unique discoveries overall';
  $('virtualPokedexGrid').replaceChildren(...entries.filter((pokemon)=>{
    if(!query)return true;
    return unlocked.has(pokemon.id) && pokemon.name.toLowerCase().includes(query);
  }).map((pokemon)=>{
    const discovered=unlocked.has(pokemon.id);
    const card=document.createElement('article');card.className='virtual-pokedex-entry'+(discovered?' discovered':'');
    const number=document.createElement('small');number.textContent='#'+String(pokemon.dexNumber).padStart(4,'0');
    const name=document.createElement('strong');name.textContent=discovered?pokemon.name:'???';
    const image=document.createElement('img');image.alt=discovered?pokemon.name:'Undiscovered Pokémon';image.loading='lazy';
    if(discovered) image.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'+pokemon.dexNumber+'.png';
    else image.src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="34" fill="%23212c43" stroke="%23516689" stroke-width="4"/%3E%3Cpath d="M16 50h68" stroke="%23516689" stroke-width="4"/%3E%3Ccircle cx="50" cy="50" r="10" fill="%230d1422" stroke="%23516689" stroke-width="4"/%3E%3C/svg%3E';
    const status=document.createElement('span');status.textContent=discovered?'Discovered':'Undiscovered';
    card.append(number,image,name,status);
    return card;
  }));
}
function switchView(view) {
  if(view==='binder')renderBinder();
  if(view==='pokedex')renderPokedex();
}
$('virtualNewBinder').addEventListener('click',()=>{
  const name=window.prompt('Name your virtual collection:');
  if(!name?.trim())return;
  const binder={id:uid(),name:name.trim().slice(0,50),pages:[newPage()]};
  binders.push(binder);activeId=binder.id;pageIndex=0;persist();
});
$('virtualRenameBinder').addEventListener('click',()=>{
  const binder=activeBinder();const name=window.prompt('Rename this virtual collection:',binder.name);
  if(!name?.trim())return;binder.name=name.trim().slice(0,50);persist();
});
$('virtualDeleteBinder').addEventListener('click',()=>{
  if(binders.length<=1){window.alert('Keep at least one virtual binder. You can rename this one instead.');return;}
  const binder=activeBinder();
  if(!window.confirm('Delete '+binder.name+'? Cards will remain in your virtual inventory.'))return;
  binders=binders.filter((item)=>item.id!==activeId);activeId=binders[0].id;pageIndex=0;persist();
});
$('virtualBinderSelect').addEventListener('change',()=>{
  activeId=$('virtualBinderSelect').value;pageIndex=0;renderBinder();
});
$('virtualBinderPageJump').addEventListener('change',()=>{
  const value=Number.parseInt($('virtualBinderPageJump').value,10);if(Number.isInteger(value)){pageIndex=value;renderBinder();}
});
$('virtualAddPage').addEventListener('click',()=>{
  const binder=activeBinder();binder.pages.splice(pageIndex+1,0,newPage());pageIndex++;persist();
});
$('virtualRemovePage').addEventListener('click',()=>{
  const binder=activeBinder();if(binder.pages.length<=1)return;
  if(!window.confirm('Remove this binder page and its card placements? Cards stay in your inventory.'))return;
  binder.pages.splice(pageIndex,1);pageIndex=Math.max(0,pageIndex-1);persist();
});
$('virtualPrevPage').addEventListener('click',()=>turnPage(-1));
$('virtualNextPage').addEventListener('click',()=>turnPage(1));
$('virtualBinderPickerClose').addEventListener('click',()=>$('virtualBinderPicker').close());
$('virtualCardDetailClose').addEventListener('click',()=>$('virtualCardDetail').close());
$('virtualPokedexRegion').replaceChildren(...REGIONS.map((region)=>new Option(region,region)));
$('virtualPokedexRegion').addEventListener('change',renderPokedex);
$('virtualPokedexSearch').addEventListener('input',renderPokedex);
$('virtualBinderBook').addEventListener('touchstart',(event)=>{touchStartX=event.changedTouches[0].clientX;},{passive:true});
$('virtualBinderBook').addEventListener('touchend',(event)=>{
  if(touchStartX===null)return;const dx=event.changedTouches[0].clientX-touchStartX;touchStartX=null;
  if(Math.abs(dx)>55)turnPage(dx<0?1:-1);
},{passive:true});
document.querySelectorAll('#virtualBinderBook .binder-drop-edge').forEach((edge)=>{
  edge.addEventListener('dragover',(event)=>{
    event.preventDefault();if(!dragged||edgeTimer)return;edge.classList.add('edge-active');
    const delta=edge.dataset.virtualDirection==='next'?1:-1;
    edgeTimer=setTimeout(async()=>{
      edgeTimer=null;await turnPage(delta);edge.classList.remove('edge-active');
    },450);
  });
  edge.addEventListener('dragleave',()=>{clearTimeout(edgeTimer);edgeTimer=null;edge.classList.remove('edge-active');});
  edge.addEventListener('drop',(event)=>{
    event.preventDefault();clearTimeout(edgeTimer);edgeTimer=null;edge.classList.remove('edge-active');
    const source=dragged;if(!source)return;
    const binder=activeBinder(),delta=edge.dataset.virtualDirection==='next'?1:-1;
    const targetPage=source.pageIndex+delta;
    if(targetPage<0||targetPage>=binder.pages.length)return;
    const from=binder.pages[source.pageIndex].slots;
    const to=binder.pages[targetPage].slots;
    const empty=to.findIndex((slot)=>!slot);
    if(empty<0)return;
    to[empty]=from[source.slotIndex];from[source.slotIndex]=null;pageIndex=targetPage;persist();
  });
});
window.addEventListener('cardbuddy-virtual-inventory-updated',()=>{
  renderBinder();renderPokedex();
});
window.addEventListener('cardbuddy-virtual-binder-render',renderBinder);
window.addEventListener('cardbuddy-virtual-pokedex-render',renderPokedex);
ensureBinder();
renderBinder();
renderPokedex();
