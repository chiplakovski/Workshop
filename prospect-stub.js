// A stand-in for the outward sweep, so the queue can be driven before anything is wired to a
// model or a network. Nothing here was found anywhere: it is a fixed set of the shapes a real
// sweep produces, written so the workflow can be judged — would you accept this? would you bin
// it? — before a single öre is spent on running one for real.
//
// Two things keep it from ever passing for real work. Every finding carries demo:true, which the
// page shows on the card and which the data layer records on the lead if one is accepted. And no
// source points at a live page: the host says demo, the name says which kind of site it stands
// for. A fabricated thread id on a real forum is exactly the lie this workshop does not tell.
(function(global){
  'use strict';

  const DAY=86400000;
  const ago=n=>new Date(Date.now()-n*DAY).toISOString().slice(0,10);

  // Written as they come off a sweep: what the post says, where it is, how far, and where it was
  // seen. The verdict is deliberately left off — the rules supply it, which is the point of
  // running the queue at all.
  const SAMPLE=[
    {klass:'repair',title:'Trasig grävskopa — söker svetsare i närheten',
     place:'Eslöv',distanceKm:18,days:1,
     need:'Cracked bucket lip and a torn ear on a 3 t excavator bucket, wants it welded up this week.',
     size:'Half a day, one man',needs:['welding'],
     sourceName:'Maskinisten (forum)',sourceUrl:'https://demo.varmak.local/maskinisten/t/118204',
     approach:'Reply in the thread — the poster asks to be contacted there.'},

    {klass:'hot',title:'Räcke till altan, 11 m, varmförzinkat',
     place:'Lund',distanceKm:29,days:2,
     need:'Eleven metres of balcony railing in steel, wants a price including fitting.',
     size:'11 m railing, 2–3 days',needs:['welding','cutting'],
     sourceName:'Byggahus (forum)',sourceUrl:'https://demo.varmak.local/byggahus/t/402117',
     approach:'Thread reply, poster asks for quotes by private message.'},

    {klass:'prototype',title:'Prototyp: ram i rostfritt för mätutrustning, 4 st',
     place:'Malmö',distanceKm:34,days:3,
     need:'Four stainless frames for a measuring rig, drawings exist, needs cutting, folding and TIG.',
     size:'4 off, small',needs:['cutting','bending','welding'],
     sourceName:'Startup community board',sourceUrl:'https://demo.varmak.local/innovation-skane/posts/771',
     approach:'Open call for a manufacturer, contact form on the post.'},

    {klass:'repair',title:'Stainless conveyor guard torn off — bakery, Landskrona',
     place:'Landskrona',distanceKm:26,days:4,
     need:'Guard and two brackets on a proofing line, stainless, must be food-safe finish.',
     size:'One day on site',needs:['welding','finishing'],
     sourceName:'Regional business board',sourceUrl:'https://demo.varmak.local/skane-foretag/posts/5512',
     approach:'Post names the maintenance manager and a public switchboard number.'},

    {klass:'subcontract',title:'Ny idrottshall i Höör — stomme tilldelad',
     place:'Höör',distanceKm:41,days:6,
     need:'Main contractor appointed for a sports hall; steel railings, stairs and guards usually go out.',
     size:'Unknown',needs:['welding','cutting'],
     sourceName:'Public award notice',sourceUrl:'https://demo.varmak.local/upphandling/notices/2026-3391',
     approach:'Main contractor listed in the notice — approach directly, no tender to answer.'},

    {klass:'hot',title:'Grindar och stolpar till gård, 2 st, 3,5 m',
     place:'Hörby',distanceKm:33,days:2,
     need:'Two farm gates and posts, wants them hot-dip galvanised after fabrication.',
     size:'2 gates',needs:['welding','cutting'],
     sourceName:'Classifieds',sourceUrl:'https://demo.varmak.local/blocket/annons/1188402',
     approach:'Advert has a phone number for enquiries.'},

    // The shop does not own a 100-ton press. The sweep is not allowed to wish one into existence,
    // so this one exists to be held down by the rules in front of the user.
    {klass:'weak',title:'Söker verkstad som kan pressa 100 ton',
     place:'Trelleborg',distanceKm:52,days:2,
     need:'Wants heavy pressing work, 100 t class.',
     size:'Unknown',needs:['pressing'],
     sourceName:'Maskinisten (forum)',sourceUrl:'https://demo.varmak.local/maskinisten/t/118311',
     approach:'Thread reply.'},

    {klass:'weak',title:'Diskussion: svårt att hitta verkstad för småserier i Skåne',
     place:'Skåne',distanceKm:null,days:5,
     need:'Several posters complain that nobody takes 1–20 piece runs. Not a job — a gap worth answering.',
     size:'—',needs:[],
     sourceName:'Industry forum',sourceUrl:'https://demo.varmak.local/industri/t/9042',
     approach:'No single contact. A visible reply in the thread is the opening.'},

    {klass:'watch',title:'Kommunen planerar ny återvinningsstation, projektering pågår',
     place:'Svalöv',distanceKm:22,days:21,
     need:'Design stage only. Steel work would come much later, if at all.',
     size:'Unknown',needs:['welding'],
     sourceName:'Municipal minutes',sourceUrl:'https://demo.varmak.local/svalov/protokoll/2026-08-14',
     approach:'Nothing to approach yet.'},

    // Deliberately unusable: no source. The triage drops it, and the page reports the drop rather
    // than pretending the sweep was cleaner than it was.
    {klass:'hot',title:'Någon på stan sa att de behöver svetsning',
     place:'Marieholm',distanceKm:2,days:1,
     need:'Hearsay.',size:'',needs:['welding'],
     sourceName:'',sourceUrl:'',approach:''}
  ];

  // One sweep's worth of findings, dated against today so freshness behaves the way it would on a
  // real morning. Deterministic: the same call gives the same list.
  function sample(){
    return SAMPLE.map((f,i)=>({
      demo:true,
      klass:f.klass,
      title:f.title,
      place:f.place,
      distanceKm:f.distanceKm,
      date:ago(f.days),
      need:f.need,
      summary:f.need,
      size:f.size,
      needs:f.needs.slice(),
      approach:f.approach,
      sourceName:f.sourceName,
      sourceUrl:f.sourceUrl,
      stubIndex:i
    }));
  }

  const ProspectStub={sample,SOURCE_COUNT:8};
  if(typeof module!=='undefined'&&module.exports)module.exports=ProspectStub;
  if(global)global.ProspectStub=ProspectStub;
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
