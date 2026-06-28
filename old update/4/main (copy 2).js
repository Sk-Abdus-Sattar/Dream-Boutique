// ═══════════════════════════════════════
// USER STATE
// ═══════════════════════════════════════
let currentUser = null;
// Bug-1 fix: set to true once onAuthStateChanged fires so DOMContentLoaded doesn't race against it
let _authResolved = false;

// ═══════════════════════════════════════
// FIREBASE INIT
// ═══════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where, getDocs, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnkKFie4vQzlykaVhnJ_cwILgk4zRQL2Q",
  authDomain: "dream-boutique-fd674.firebaseapp.com",
  projectId: "dream-boutique-fd674",
  storageBucket: "dream-boutique-fd674.firebasestorage.app",
  messagingSenderId: "510483704329",
  appId: "1:510483704329:web:06906cca8ec2d901b0a6d8",
  measurementId: "G-VVX092ZF68"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
setPersistence(auth, browserLocalPersistence);

// Handle redirect sign-in result on mobile (fires before onAuthStateChanged)
getRedirectResult(auth).catch(() => {
  // Ignore — onAuthStateChanged handles the success case
});

// ─── Auth state listener — mobile-safe, timing-robust ───
// Track page load time so we can calculate remaining intro time
// no matter how fast or slow Firebase resolves on a real network.
let _introDismissed = false;
const _pageLoadTime = Date.now();

function dismissIntroToSignIn() {
  if (_introDismissed) return;
  _introDismissed = true;
  document.getElementById('introScreen').classList.add('hide');
  document.getElementById('gSignInScreen').classList.remove('hide');
  document.getElementById('gSignInScreen').classList.add('show');
}

function dismissIntroToApp() {
  if (_introDismissed) return;
  _introDismissed = true;
  document.getElementById('introScreen').classList.add('hide');
  document.getElementById('gSignInScreen').classList.add('hide');
  document.getElementById('gSignInScreen').classList.remove('show');
  onUserReady();
}

onAuthStateChanged(auth, async (user) => {
  _authResolved = true;
  if (user) {
    currentUser = {
      name: user.displayName,
      given_name: user.displayName ? user.displayName.split(' ')[0] : '',
      email: user.email,
      picture: user.photoURL,
      uid: user.uid,
    };
    // Respect the 2800ms intro animation but account for time already elapsed
    const elapsed = Date.now() - _pageLoadTime;
    const remaining = Math.max(0, 2800 - elapsed);
    setTimeout(dismissIntroToApp, remaining);
  } else {
    currentUser = null;
    const elapsed = Date.now() - _pageLoadTime;
    const remaining = Math.max(0, 2800 - elapsed);
    setTimeout(dismissIntroToSignIn, remaining);
  }
});

async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      // Popups are blocked on mobile Chrome — use redirect flow instead
      await signInWithRedirect(auth, provider);
      // Page will reload; onAuthStateChanged picks up the user on return
    } else {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      currentUser = {
        name: user.displayName,
        given_name: user.displayName ? user.displayName.split(' ')[0] : '',
        email: user.email,
        picture: user.photoURL,
        uid: user.uid,
      };
      onUserReady();
    }
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      toast('Sign-in failed. Please try again ✿');
    }
  }
}

async function doLogout() {
  await signOut(auth);
  currentUser = null;
  try { localStorage.removeItem('db_device'); } catch(e) {}
  // Hide app, hide profile panel
  document.getElementById('logoutConfirm').classList.remove('open');
  document.getElementById('profilePanel').classList.remove('open');
  document.getElementById('profileVeil').classList.remove('open');
  document.getElementById('mainApp').classList.remove('show');
  // Push sign-in to history and show sign-in screen
  history.pushState({ page: 'signin' }, '', '#signin');
  document.getElementById('gSignInScreen').classList.add('show');
  document.getElementById('gSignInScreen').classList.remove('hide');
}

// ─── Fetch user's purchased products ───
async function getUserPurchases(email) {
  if (!email) return [];
  const q = query(collection(db, 'purchases'), where('email', '==', email));
  const snap = await getDocs(q);
  if (snap.empty) return [];
  let all = [];
  snap.forEach(d => {
    const p = d.data().products;
    if (Array.isArray(p)) all = all.concat(p);
  });
  return [...new Set(all)];
}

// ─── Fetch products the user has already reviewed ───
async function getUserReviewedProducts(email) {
  if (!email) return [];
  const q = query(collection(db, 'reviews'), where('email', '==', email));
  const snap = await getDocs(q);
  const reviewed = [];
  snap.forEach(d => reviewed.push(d.data().product));
  return reviewed;
}

// ─── Save review to Firestore ───
async function saveReview(reviewData) {
  await addDoc(collection(db, 'reviews'), {
    ...reviewData,
    createdAt: serverTimestamp(),
  });
}

// ─── Load all reviews from Firestore into the grid ───
async function loadReviews() {
  const q = query(collection(db, 'reviews'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const grid = document.getElementById('reviewsGrid');
  snap.forEach(docSnap => {
    const r = docSnap.data();
    const card = document.createElement('div');
    card.className = 'rcard fade-up in';
    card.innerHTML = `<div class="rcard-quote">"</div><div class="rcard-stars">${starsToDisplay(r.rating)}</div><p class="rcard-text">${r.review}</p><p class="rcard-author">${r.name}</p><p class="rcard-loc" style="font-size:11px;color:var(--text-light);margin-top:2px;">${r.product || ''}</p>`;
    grid.appendChild(card);
  });
}

// ─── Populate product dropdown with only purchased & unreviewed items ───
async function populateReviewDropdown() {
  const select = document.getElementById('fproduct');
  select.innerHTML = '<option value="">— Select a product —</option>';

  if (!currentUser || !currentUser.email) {
    document.getElementById('feedbackForm').style.display = 'none';
    document.getElementById('reviewPurchaseGate').style.display = 'block';
    return;
  }

  const [purchased, reviewed] = await Promise.all([
    getUserPurchases(currentUser.email),
    getUserReviewedProducts(currentUser.email),
  ]);

  currentUser.purchases = purchased;

  const available = purchased.filter(p => !reviewed.includes(p));

  if (purchased.length === 0) {
    document.getElementById('feedbackForm').style.display = 'none';
    document.getElementById('reviewPurchaseGate').style.display = 'block';
    return;
  }

  if (available.length === 0) {
    document.getElementById('feedbackForm').style.display = 'none';
    document.getElementById('reviewPurchaseGate').style.display = 'block';
    document.getElementById('reviewPurchaseGate').innerHTML = `
      <div style="font-size:40px;margin-bottom:12px;">🌸</div>
      <p style="font-family:'Playfair Display',serif;font-size:18px;color:var(--text);margin-bottom:8px;">All Reviews Submitted</p>
      <p style="font-size:13px;color:var(--text-light);line-height:1.7;">You've reviewed all your purchased items. Thank you so much for sharing your experience!</p>`;
    return;
  }

  available.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  document.getElementById('reviewPurchaseGate').style.display = 'none';
  document.getElementById('feedbackForm').style.display = 'block';
}

function renderProfilePurchases(purchases) {
  const el = document.getElementById('purchaseCount');
  if (!el) return;
  if (!purchases || purchases.length === 0) {
    el.textContent = 'No purchases yet';
    return;
  }
  el.textContent = `${purchases.length} item${purchases.length > 1 ? 's' : ''} purchased`;
}

function continueAsGuest() {
  currentUser = { name: 'Guest', given_name: 'Guest', email: null, picture: null, uid: null };
  onUserReady();
}

// ─── onUserReady: shows device picker, or skips it if already chosen ───
function onUserReady() {
  document.getElementById('gSignInScreen').classList.add('hide');
  document.getElementById('gSignInScreen').classList.remove('show');

  // If user already picked a device (e.g. returning from terms.html), skip picker
  let savedDevice = null;
  try { savedDevice = localStorage.getItem('db_device'); } catch(e) {}
  if (savedDevice) { selectDevice(savedDevice); return; }

  const ds = document.getElementById('deviceScreen');
  ds.classList.add('show');
  ds.classList.remove('hide');
  if (currentUser && currentUser.given_name && currentUser.given_name !== 'Guest') {
    document.getElementById('devWelcomeText').textContent = 'Welcome, ' + currentUser.given_name;
    document.getElementById('devUserName').innerHTML = 'You\'re stepping into <em>the Dream</em>';
  }
  // Highlight the auto-detected card
  const detected = window._detectedDevice || 'desktop';
  const cardMap = { desktop: 'devCardDesktop', tablet: 'devCardTablet', mobile: 'devCardMobile' };
  const card = document.getElementById(cardMap[detected]);
  if (card) card.classList.add('detected');
  history.replaceState({ page: 'device' }, '', '#device');
}

function selectDevice(type) {
  // Persist device choice so navigating away and back skips the picker
  try { localStorage.setItem('db_device', type); } catch(e) {}

  const ds = document.getElementById('deviceScreen');
  ds.classList.add('hide');
  ds.classList.remove('show');
  const loader = document.getElementById('loader');
  loader.classList.add('show');

  if (type === 'mobile' || type === 'tablet') {
    document.body.classList.add('mobile-view');
  } else {
    document.body.classList.remove('mobile-view');
  }

  setTimeout(() => {
    loader.classList.add('out');
    const app = document.getElementById('mainApp');
    app.classList.add('show');
    history.replaceState({ page: 'home' }, '', '#home');
    initApp();
  }, 1800);
}

// ─── Handle back/forward navigation ───
window.addEventListener('popstate', (e) => {
  // Guard: during a redirect sign-in return, _authResolved may still be false
  // and currentUser null — don't react to history events until auth is settled
  if (!_authResolved) return;

  const hash = location.hash;
  const app = document.getElementById('mainApp');
  const isAppShowing = app && app.classList.contains('show');

  if (hash === '#signin' || hash === '') {
    // Only go to sign-in if not logged in AND intro is already done
    if (_introDismissed && (!currentUser || currentUser.email === null)) {
      app && app.classList.remove('show');
      document.getElementById('gSignInScreen').classList.add('show');
      document.getElementById('gSignInScreen').classList.remove('hide');
    } else {
      // Logged in user going back — stay on home
      history.replaceState({ page: 'home' }, '', '#home');
    }
  } else if (hash === '#home') {
    // Close any overlays
    document.getElementById('cartPanel').classList.remove('open');
    document.getElementById('cartVeil').classList.remove('open');
    document.getElementById('profilePanel').classList.remove('open');
    document.getElementById('profileVeil').classList.remove('open');
    document.getElementById('modalVeil').classList.remove('open');
    document.body.style.overflow = '';
  } else if (hash === '#device') {
    // Don't allow going back to device picker once app is loaded
    if (isAppShowing) {
      history.pushState({ page: 'home' }, '', '#home');
    }
  }
});

// ═══════════════════════════════════════
// PRODUCT DATA
// ═══════════════════════════════════════
const uploadedImgs = {
  1:'./images/btq1.png', 2:'./images/btq2.png',
  3:'./images/btq3.png', 4:'./images/btq4.png',
  5:'./images/btq5.png', 6:'./images/btq6.png',
  7:'./images/btq7.png', 8:'./images/btq8.png',
  9:'./images/btq9.png', 10:'./images/btq10.png',
  11:'./images/btq11.png', 12:'./images/btq12.png',
  13:'./images/btq13.png', 14:'./images/btq14.png',
  15:'./images/btq15.png', 16:'./images/btq16.png',
  17:'./images/btq17.png', 18:'./images/btq18.png',
  19:'./images/btq19.png', 20:'./images/btq20.png',
  21:'./images/btq21.png', 22:'./images/btq22.png',
  23:'./images/btq23.png', 24:'./images/btq24.png',
  25:'./images/btq25.png', 26:'./images/btq26.png',
  27:'./images/btq27.png', 28:'./images/btq28.png',
  29:'./images/btq29.png', 30:'./images/btq30.png'
};
const bgColors={1:'#B8D4E8',2:'#2C3E6E',3:'#8B2635',4:'#C4A0A0',5:'#F5F0A0',6:'#B8D4B0',7:'#C4B0D4',8:'#F0EDE0',9:'#F0EDE0',10:'#F0EDE0',11:'#2C3E6E',12:'#1A1A1A',13:'#2C3E6E',14:'#C4956A',15:'#E8E0D4',16:'#8B9A6E',17:'#8B2635',18:'#E8A0B0',19:'#C4B0D4',20:'#B8D4B0',21:'#C8C8C8',22:'#F0EDE0',23:'#8B7355',24:'#F0EDE0',25:'#F0B8C0',26:'#D4A820',27:'#E83870',28:'#C4956A',29:'#D4A820',30:'#C4B0D4'};

const products=[
  {id:1,name:"Sky Blue Striped Belted Dress",cat:"modest",tag:"Modest Wear",price:"2499",stock:true,desc:"A fresh breath of sky — this sleeveless sky blue striped overdress is the kind of piece that makes modesty look effortlessly chic. Featuring warm-toned wooden buttons running the full length, two deep patch pockets at the hip, and a cinched waist with a sleek double-ring black belt, it layers beautifully over a fitted black full-sleeve inner. The subtle vertical stripe pattern creates a lengthening silhouette, while the airy fabric ensures all-day comfort. Perfect for brunches, college outings, or casual festive gatherings."},
  {id:2,name:"Navy Blue Belted Maxi Dress",cat:"modest",tag:"Modest Wear",price:"2699",stock:true,desc:"Deep, decisive, and utterly sophisticated — this navy blue belted maxi dress is structured modesty at its finest. The sleeveless silhouette is perfectly balanced by a white full-sleeve inner, while the matching navy dupatta draped over the shoulders adds a regal finishing touch. Two large hip pockets and a metallic double-ring belt complete the look. Crisp cotton fabric with a relaxed A-line fall makes this the go-to piece for both everyday elegance and special occasions across every season."},
  {id:3,name:"Maroon Corduroy Belted Dress",cat:"modest",tag:"Modest Wear",price:"2899",stock:true,desc:"Deep crimson drama with quiet refinement — this maroon corduroy sleeveless dress is a statement in restraint. The rich ribbed texture catches the light beautifully, while the full-button front placket and belted waist create a structured, flattering silhouette. Layered over a classic black full-sleeve inner, it becomes a complete modest outfit with effortless polish. Two patch pockets add a practical, casual edge. Ideal for festive days, Eid mornings, or styled evenings where you want to be remembered."},
  {id:4,name:"Dusty Rose Corduroy Dress",cat:"modest",tag:"Modest Wear",price:"2899",stock:false,desc:"Warm blush tones wrapped in the softness of fine corduroy — this dusty rose belted overdress is romance made wearable. The delicate pink-mauve hue complements a wide range of skin tones, while the full-length button placket, structured pockets, and cinched black belt create a composed, editorial silhouette. Paired over a black inner, it transforms into a complete modest ensemble that moves between everyday wear and dressed-up occasions with equal grace."},
  {id:5,name:"Lemon Yellow Lace Kurta",cat:"ethnic",tag:"Ethnic Wear",price:"1899",stock:true,desc:"Sunshine captured in fabric — this lemon yellow textured kurta is pure poetry. Crafted in crinkled cotton with a soft feminine drape, the yoke is adorned with intricate white lace floral embroidery that cascades gently onto the bust. Puff sleeves add a touch of whimsy, and the flowy gathered silhouette below the empire waist creates effortless volume. Styled with an ivory ribbed inner and pearl jewellery, this piece is for the woman who dresses like she's walking through a garden in full bloom."},
  {id:6,name:"Sage Green Lace Kurta",cat:"ethnic",tag:"Ethnic Wear",price:"1999",stock:true,desc:"The colour of fresh leaves after rain — this sage green textured kurta is nature's most elegant shade rendered in cloth. The crinkle fabric adds an organic, lived-in beauty, while tonal white lace embroidery across the square neckline and cap sleeves lend it a delicate artisanal quality. The empire waist gathers into a flowing skirt that moves like a whisper. Wear it to a garden party, a family gathering, or simply on a day you want to feel particularly lovely and at peace."},
  {id:7,name:"Lavender Lace Kurta",cat:"ethnic",tag:"Ethnic Wear",price:"1999",stock:true,desc:"Soft as dusk, dreamy as a lullaby — this lavender crinkle kurta is pure feminine elegance. The dusty lilac hue is one of those rare shades that flatters without trying, while delicate white lace butterfly and floral embroidery across the cap sleeves and square neckline adds a hand-crafted charm. The flowing, gathered lower silhouette drapes beautifully and skims the body with ease. This is the piece for days when you want to feel gentle, beautiful, and utterly yourself."},
  {id:8,name:"Ivory Lace Maxi Dress",cat:"ethnic",tag:"Ethnic Wear",price:"3499",stock:true,desc:"An heirloom in the making — this ivory crinkle cotton maxi dress is quiet luxury at its most wearable. Tonal white lace trims the square neckline and cap sleeves, while the full-length tiered skirt flows generously to the floor. The fabric has a soft, natural crinkle texture that lends it an organic, artistic quality. Styled with pearls and spring blooms, this dress is made for soft mornings, elegant occasions, and every beautiful moment you want to hold onto forever."},
  {id:9,name:"Ivory Floral Embroidered Kurta",cat:"kurta",tag:"Kurta Set",price:"2999",stock:true,desc:"Tone-on-tone luxury — this ivory embroidered kurta set is refinement defined. The fabric is a soft textured cotton-mix, and large tonal floral embroidery spreads across the chest and hem with artistry that feels both traditional and modern. Pearl-white buttons run down the centre front, while the matching bottoms complete the co-ordinated look. A pearl necklace is all this piece needs. It whispers rather than shouts — and is heard all across the room."},
  {id:10,name:"Ivory Full-Sleeve Floral Kurta",cat:"kurta",tag:"Kurta Set",price:"3200",stock:false,desc:"Florals done the right way — not bold, not shy, but perfectly measured. This ivory full-sleeve kurta features large tonal embroidered blooms on a softly sheer fabric, creating a layered, dimensional effect. The full placket of pearl buttons, A-line silhouette, and accompanying dupatta make it a complete festive set. Long sleeves gathered into soft cuffs add a delicate finishing detail. This is the set you wear when the occasion deserves your best — and so do you, always."},
  {id:11,name:"Navy Cable Knit Vest Set",cat:"western",tag:"Western Co-ord",price:"2499",stock:true,desc:"Preppy, polished, and perfectly modest — this navy cable-knit sweater vest paired with white wide-leg trousers is a co-ord set that lives between campus chic and café elegance. The deep V-neck vest features classic white trim at the neckline and hem, with a rich cable-knit texture that adds warmth. Worn over a white ribbed turtleneck, the silhouette is layered and effortlessly put-together. A set that dresses up or down with equal ease and grace."},
  {id:12,name:"Black Argyle Knit Vest Set",cat:"western",tag:"Western Co-ord",price:"2599",stock:true,desc:"Classic with an edge — this bold black and ivory argyle diamond-pattern knit vest is a statement in vintage-modern dressing. The geometric pattern is bold yet structured, and the deep V-neck over a black ribbed turtleneck creates a layered look that is as modest as it is stylish. Paired with dark wash wide-leg denim, this is the co-ord set for the woman who takes style seriously. A nod to preppy heritage, reimagined for the modern modest wardrobe."},
  {id:13,name:"Navy Ribbed Vest + Light Wash Jeans",cat:"western",tag:"Western Co-ord",price:"2299",stock:true,desc:"Clean, classic, and quietly confident — this navy ribbed knit vest with white V-neck stripe trim is casual dressing elevated to an art form. Worn over a white turtleneck and paired with light-wash wide-leg jeans featuring a subtle ice-blue wash effect, the combination is fresh, modern, and impeccably modest. A co-ord you will return to week after week for its ease and effortless elegance."},
  {id:14,name:"Camel Argyle Vest Set",cat:"western",tag:"Western Co-ord",price:"2699",stock:true,desc:"Warmth in every detail — this camel and ivory diamond-pattern knit vest is the definition of autumnal elegance. The open-knit argyle design adds texture and a handcrafted feel, while the warm camel tones pair beautifully with the white ribbed turtleneck layered beneath. Matched with mid-wash blue wide-leg denim, this set exudes an easy, academic charm. Whether for a day out or a quiet evening, this co-ord always looks exactly right."},
  {id:15,name:"Ivory Houndstooth Vest Set",cat:"western",tag:"Western Co-ord",price:"2799",stock:true,desc:"A study in contrast — this ivory and black houndstooth-weave knit vest is pattern done with sophistication and restraint. The densely woven geometric texture creates a visual richness that reads as both classic and contemporary. Worn over a black ribbed turtleneck and styled with dark wash marble-washed wide-leg jeans, this is the co-ord for the woman who likes her fashion with a clear point of view. Timeless in every single season."},
  {id:16,name:"Olive Green Floral Appliqué Set",cat:"kurta",tag:"Kurta Set",price:"3100",stock:true,desc:"Nature's palette in its most graceful form — this olive green kurta set is adorned with hand-crafted floral appliqué in blush pink, sage, and cream along the dupatta hem. The V-neck pintuck kurta falls in a generous, flowing A-line with smocked cuffs for a soft, gathered finish. The olive green shade is earthy yet refined, complementing every skin tone with warmth. A set that transitions beautifully from Eid celebrations to family functions and beyond."},
  {id:17,name:"Deep Red Pintuck Kurta Set",cat:"kurta",tag:"Kurta Set",price:"3499",stock:true,desc:"Passionate, celebratory, and undeniably striking — this deep red pintuck kurta set is everything festive dressing should be. The kurta features delicate pin-tucking at the chest with subtle bead detailing, smocked cuffs, and a full flowing skirt that moves with purpose. The matching dupatta is bordered with three-dimensional floral appliqué in tangerine and emerald — a detail of extraordinary artisanship. This red set announces itself with pure joy."},
  {id:18,name:"Blush Pink Pintuck Kurta Set",cat:"kurta",tag:"Kurta Set",price:"3399",stock:false,desc:"The softest celebration you've ever worn — this blush pink pintuck kurta set is femininity in its most graceful form. Fine pin-tucks across the chest are accented with delicate lace trim and tiny pearl beading, while the full gathered skirt falls beautifully to ankle length. The dupatta carries a scattering of 3D floral appliqué in hot pink and sage green — each bloom individually stitched with care. A set made for moments that deserve to be remembered."},
  {id:19,name:"Lavender Floral Stripe Top Set",cat:"western",tag:"Western Co-ord",price:"1799",stock:true,desc:"Cottage-core romance meets modest street style — this lavender and white striped sleeveless top is a breath of fresh air. The front features a row of lace trim buttons and scattered hand-embroidered purple daisy motifs, while the ruffled peplum hem adds movement and playfulness. Styled over a cream ribbed inner and paired with light-wash wide-leg denim, this set is for the woman who dresses like every single day is worth celebrating."},
  {id:20,name:"Sage Green Floral Stripe Top Set",cat:"western",tag:"Western Co-ord",price:"1799",stock:true,desc:"Green like growth, fresh like beginnings — this sage green striped sleeveless top with hand-embroidered floral details is spring made wearable. The lace-trim button placket runs down the centre, flanked by delicate stitched blooms, while the ruffled peplum hem adds a playful, feminine edge. Worn over a cream ribbed inner and matched with dark wash wide-leg jeans, it creates a balanced contrast that feels polished and purposeful every time."},
  {id:21,name:"Grey Stripe Floral Top Set",cat:"western",tag:"Western Co-ord",price:"1850",stock:true,desc:"Understated yet utterly charming — this grey and ivory striped sleeveless top with embroidered floral accents proves that neutral tones are never boring. The delicate floral embroidery in silver-grey tones cascades down the lace-trim button placket, while the peplum ruffle adds a feminine silhouette. Paired over a cream ribbed inner and matched with deep charcoal wide-leg jeans, this co-ord is for the woman who leads with quiet confidence."},
  {id:22,name:"Cream Gold Tassel Kurta Set",cat:"kurta",tag:"Kurta Set",price:"3600",stock:true,desc:"Understated luxury in its purest expression — this cream three-piece set in silky smooth fabric is dressed with gold tassel and lace trim detailing at the neckline, hem, and dupatta edges. The V-neck kurta falls in a clean, straight silhouette with wide sleeves that gather softly at the wrist with golden tassel accents. The matching pants and flowing dupatta complete a harmonious look of quiet opulence. Ideal for every occasion where you want to be peacefully, impeccably dressed."},
  {id:23,name:"Mocha Tassel Kurta Set",cat:"kurta",tag:"Kurta Set",price:"3799",stock:true,desc:"Earthy, warm, and deeply sophisticated — this mocha brown three-piece kurta set in flowing satin-touch fabric is elegance dressed in the richest earth tones. Gold tassels and lace trim at the V-neckline, hem, and dupatta border add a regal, artisanal finish that elevates the simplicity of the silhouette. A complete look that requires nothing more than your graceful presence."},
  {id:24,name:"Ivory Cherry Blossom Maxi",cat:"ethnic",tag:"Ethnic Wear",price:"3999",stock:true,desc:"The season's most romantic dress — this ivory maxi in the lightest cotton gauze is scattered with miniature hand-embroidered cherry blossom motifs in red, ivory, and sage green. The lace Peter Pan collar adds a vintage, storybook sweetness, while the full-length gathered silhouette drapes with an effortless, dreamy quality. Long sleeves with puffed cuffs complete the ethereal look. This dress belongs to the moments you wish you could live in forever."},
  {id:25,name:"Blush Cherry Blossom Maxi",cat:"ethnic",tag:"Ethnic Wear",price:"3999",stock:true,desc:"Pretty in pink, exquisite in every detail — this blush pink maxi dress in softly crinkled cotton gauze is adorned with scattered cherry blossom embroidery in red, white, and green. The lace Peter Pan collar frames the face with delicate sweetness, while the full gathered length and balloon sleeves create a silhouette of romantic abundance. Feminine without apology, modest without effort."},
  {id:26,name:"Mustard Cherry Blossom Maxi",cat:"ethnic",tag:"Ethnic Wear",price:"4100",stock:false,desc:"Bold warmth in a floral dream — this golden mustard maxi in crinkled cotton gauze is one of those rare pieces where colour and embroidery exist in perfect dialogue. Scattered cherry blossom sprigs in red, white, and emerald green bring the fabric to life, while the lace collar and gathered flowing silhouette make it unequivocally special. The mustard tone catches golden-hour light magnificently."},
  {id:27,name:"Hot Pink Cherry Blossom Maxi",cat:"ethnic",tag:"Ethnic Wear",price:"4299",stock:true,desc:"Vibrant, unapologetic, and strikingly beautiful — this hot pink crinkle cotton maxi is not for the faint of heart. Scattered cherry blossom embroidery in red, white, and ivory pops against the deep fuchsia ground with an energy that is impossible to ignore. The lace yoke collar and pintuck detailing at the chest add structure and artisanship. Wear this when you want every head in the room to turn."},
  {id:28,name:"Camel Cherry Blossom Maxi",cat:"ethnic",tag:"Ethnic Wear",price:"3999",stock:true,desc:"Warmth, earthiness, and quiet festivity — this camel brown crinkle cotton maxi is a stunning display of subtle artistry. Cherry blossom sprigs in red, white, and green are scattered across the full length with a generous hand. The lace collar adds a delicate anchor at the neckline, while the gathered silhouette and long smocked sleeves create a balanced, enveloping form. A colour that grounds you, a pattern that lifts you."},
  {id:29,name:"Golden Mustard Heart Collar Kurta",cat:"kurta",tag:"Kurta Set",price:"3299",stock:true,desc:"The most romantic kurta in the collection — this golden mustard piece is set apart by its extraordinary heart-shaped crochet lace collar, a detail so unique it stops you in your tracks. Large red floral embroidery is scattered across the full length of the kurta and matching dupatta, while the pintuck chest detailing and golden lace yoke border add layers of craftsmanship. This is not a kurta you simply wear — it is a kurta that wears you."},
  {id:30,name:"Dusty Lavender Embroidered Co-ord",cat:"kurta",tag:"Kurta Set",price:"3800",stock:true,desc:"Ethereal, intricately detailed, and unmistakably luxurious — this dusty lavender two-piece co-ord set in flowing fabric is embellished with stunning white thread embroidery in a trailing vine and starburst pattern across both the top and wide-leg pants. Pearl trim lines the sleeves and hem, adding a final touch of delicate opulence. The silhouette is relaxed and dignified. Wear it to any occasion when ordinary dressing simply won't do."}
];

// ═══════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════
function initApp() {
  if (currentUser && currentUser.name !== 'Guest') {
    document.getElementById('profileNavBtn').style.display = 'flex';
    document.getElementById('navUserChip').style.display = 'none';
    document.getElementById('profileNavInitial').textContent = currentUser.given_name ? currentUser.given_name[0].toUpperCase() : currentUser.name[0].toUpperCase();
    document.getElementById('profileNavName').textContent = currentUser.given_name || currentUser.name;

    const profileAvatarWrap = document.getElementById('profileAvatarWrap');
    if (profileAvatarWrap) {
      if (currentUser.picture) {
        profileAvatarWrap.innerHTML = `<img src="${currentUser.picture}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto;display:block;">`;
      } else {
        profileAvatarWrap.innerHTML = `<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--rose),var(--gold));color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;font-family:'Playfair Display',serif;margin:0 auto;">${currentUser.name[0].toUpperCase()}</div>`;
      }
    }
    const pName = document.getElementById('profileName');
    const pEmail = document.getElementById('profileEmail');
    if (pName) pName.textContent = currentUser.name;
    if (pEmail) pEmail.textContent = currentUser.email || '';

    document.getElementById('loggedInNote').style.display = 'flex';
    document.getElementById('formAvatar').textContent = currentUser.name[0].toUpperCase();
    document.getElementById('formUserName').textContent = currentUser.name;
  } else {
    document.getElementById('profileNavBtn').style.display = 'none';
    document.getElementById('loggedInNote').style.display = 'none';
  }

  renderProducts();
  observeFades();
  loadReviews();
  loadCartFromStorage(); // Bug-6 fix: restore persisted cart
  document.getElementById('feedbackForm').style.display = 'none';
  document.getElementById('reviewPurchaseGate').style.display = 'block';
  populateReviewDropdown().then(() => {
    if (currentUser && currentUser.purchases) {
      renderProfilePurchases(currentUser.purchases);
    }
  });
}

// ═══════════════════════════════════════
// PRODUCT RENDER
// ═══════════════════════════════════════
let cart = [], currentProd = null;

// ── Bug-6 fix: cart persistence helpers ──
function cartKey() {
  return currentUser && currentUser.email ? `db_cart_${currentUser.email}` : null;
}
function saveCartToStorage() {
  const key = cartKey();
  if (key) localStorage.setItem(key, JSON.stringify(cart.map(p => p.id)));
}
function loadCartFromStorage() {
  const key = cartKey();
  if (!key) return;
  try {
    const ids = JSON.parse(localStorage.getItem(key) || '[]');
    cart = ids.map(id => products.find(p => p.id === id)).filter(Boolean);
    updateCart();
  } catch(e) { cart = []; }
}

function productCardHTML(p) {
  const img = uploadedImgs[p.id];
  const imgEl = img
    ? `<img class="pcard-img" src="${img}" alt="${p.name}" loading="lazy"/>`
    : `<div style="width:100%;height:100%;background:${bgColors[p.id]}25;display:flex;align-items:center;justify-content:center;font-size:48px;opacity:0.2;">✿</div>`;
  const stockBadge = p.stock
    ? `<span class="stock-badge in">● In Stock</span>`
    : `<span class="stock-badge out">● Out of Stock</span>`;
  return `<div class="pcard fade-up" data-product-id="${p.id}">
    <div class="pcard-img-wrap">${imgEl}
      <span class="pcard-badge">${p.tag}</span>
      ${stockBadge}
    </div>
    <div class="pcard-info">
      <p class="pcard-tag">${p.tag}</p>
      <h3 class="pcard-name">${p.name}</h3>
      <p class="pcard-desc">${p.desc.substring(0,115)}…</p>
      <div class="pcard-foot">
        <span class="pcard-price">₹${Number(p.price).toLocaleString('en-IN')}</span>
        <div class="pcard-actions">
          <button class="add-bag-btn" data-add-cart="${p.id}" title="Add to Bag">🛍</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderProducts(filter='all') {
  const grid = document.getElementById('productGrid');
  const list = filter==='all' ? products : products.filter(p=>p.cat===filter);
  grid.innerHTML = list.map(productCardHTML).join('');
  // Attach event listeners via delegation
  grid.querySelectorAll('.pcard').forEach(card => {
    const id = parseInt(card.dataset.productId);
    card.addEventListener('click', () => openModal(id));
  });
  grid.querySelectorAll('[data-add-cart]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); addToCart(parseInt(btn.dataset.addCart)); });
  });
  observeFades();
}

function filterP(cat, btn) {
  document.querySelectorAll('.filt-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts(cat);
}

// ═══════════════════════════════════════
// CART
// ═══════════════════════════════════════
function addToCart(id, fromModal=false) {
  if (!currentUser || currentUser.name === 'Guest') {
    if (fromModal) closeModalDirect();
    document.getElementById('loginWall').classList.add('open');
    return;
  }
  const p = products.find(x=>x.id===id);
  if (!p.stock) { toast('This piece is currently out of stock ✿'); return; }
  if (!cart.find(x=>x.id===id)) { cart.push(p); updateCart(); saveCartToStorage(); toast(`"${p.name}" added to your bag ✿`); }
  else toast('Already in your bag ✿');
  if (fromModal) closeModalDirect();
}
function addToCartFromModal() { if (currentProd) addToCart(currentProd.id, true); }
function removeFromCart(id) { cart=cart.filter(x=>x.id!==id); updateCart(); saveCartToStorage(); }

function updateCart() {
  document.getElementById('cartCount').textContent = cart.length;
  const mbc = document.getElementById('mobileBagCount');
  if (mbc) mbc.textContent = cart.length;
  const body = document.getElementById('cartBody');
  const empty = document.getElementById('cartEmpty');
  body.querySelectorAll('.cart-item-row').forEach(el=>el.remove());
  if (cart.length===0) {
    empty.style.display='flex';
    document.getElementById('cartTotal').textContent='₹0';
    return;
  }
  empty.style.display='none';
  const total = cart.reduce((s,p)=>s+Number(p.price),0);
  document.getElementById('cartTotal').textContent='₹'+total.toLocaleString('en-IN');
  cart.forEach(p=>{
    const img=uploadedImgs[p.id];
    const thumb=img?`<img class="cart-item-thumb" src="${img}" alt="${p.name}"/>`:`<div class="cart-item-thumb-placeholder" style="background:${bgColors[p.id]}30;">✿</div>`;
    const row=document.createElement('div');
    row.className='cart-item-row';
    row.innerHTML=`${thumb}<div class="citem-info"><p class="citem-cat">${p.tag}</p><p class="citem-name">${p.name}</p><p class="citem-price">₹${Number(p.price).toLocaleString('en-IN')}</p></div><button class="citem-remove" data-remove="${p.id}">×</button>`;
    row.querySelector('[data-remove]').addEventListener('click', () => removeFromCart(p.id));
    body.appendChild(row);
  });
}

function toggleCart(){
  document.getElementById('cartPanel').classList.toggle('open');
  document.getElementById('cartVeil').classList.toggle('open');
}

function checkoutCart(){
  if(!cart.length)return;
  toast('Please use Buy Now on individual items to place your order ✿');
}

// ═══════════════════════════════════════
// MODAL
// ═══════════════════════════════════════
function openModal(id){
  const p=products.find(x=>x.id===id);
  currentProd=p;
  const img=document.getElementById('modalImg');
  img.src=uploadedImgs[p.id]||'';
  img.style.display=uploadedImgs[p.id]?'block':'none';
  document.getElementById('modalTag').textContent=p.tag;
  document.getElementById('modalName').textContent=p.name;
  document.getElementById('modalPrice').textContent='₹'+Number(p.price).toLocaleString('en-IN');
  document.getElementById('modalDesc').textContent=p.desc;
  const stock=document.getElementById('modalStock');
  stock.className='modal-stock '+(p.stock?'in':'out');
  stock.innerHTML=(p.stock?'● In Stock':'● Out of Stock');
  document.getElementById('modalQty').textContent='1';
  document.getElementById('modalVeil').classList.add('open');
  document.body.style.overflow='hidden';
  // Push product hash for back-button support
  history.pushState({ page: 'product', id: p.id }, '', `#product/${p.id}`);
}
function closeModal(e){if(e.target===document.getElementById('modalVeil'))closeModalDirect();}
function closeModalDirect(){
  document.getElementById('modalVeil').classList.remove('open');
  document.body.style.overflow='';
  currentProd=null;
  document.getElementById('modalQty').textContent='1';
  // Go back to #home in history
  if (location.hash.startsWith('#product/')) {
    history.back();
  }
}

// ═══════════════════════════════════════
// QTY CONTROL
// ═══════════════════════════════════════
function changeQty(delta) {
  const el = document.getElementById('modalQty');
  let v = parseInt(el.textContent) + delta;
  if (v < 1) v = 1;
  if (v > 10) v = 10;
  el.textContent = v;
}

// ═══════════════════════════════════════
// BUY NOW
// ═══════════════════════════════════════
const EJS_SERVICE  = 'Dream Boutique';
const EJS_TEMPLATE = 'template_3gu6aux';
const EJS_PUBKEY   = 'JsS_HIYQlBNniDhUK';

emailjs.init(EJS_PUBKEY);

async function buyNow() {
  if (!currentUser || currentUser.name === 'Guest') {
    closeModalDirect();
    document.getElementById('loginWall').classList.add('open');
    return;
  }
  if (!currentProd) return;
  if (!currentProd.stock) { toast('This piece is currently out of stock ✿'); return; }

  // Bug-3 fix: show loading state on ALL buy-now buttons while processing
  const buyBtns = document.querySelectorAll('.modal-btns .btn-rose, .modal-sticky-actions .btn-rose');
  buyBtns.forEach(btn => {
    btn.disabled = true;
    btn.dataset.origText = btn.textContent;
    btn.textContent = '⏳ Placing Order…';
    btn.style.opacity = '0.75';
  });
  // Freeze the entire screen — block all user interaction
  document.getElementById('orderFreezeOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';

  const qty = parseInt(document.getElementById('modalQty').textContent) || 1;
  const totalAmt = Number(currentProd.price) * qty;
  const orderData = {
    productName: currentProd.name,
    productId: currentProd.id,
    price: currentProd.price,
    quantity: qty,
    totalAmount: totalAmt,
    buyerEmail: currentUser.email,
    buyerName: currentUser.name,
    orderedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  };

  try {
    // 1. Log order to Firestore
    await addDoc(collection(db, 'orders'), {
      ...orderData,
      createdAt: serverTimestamp(),
    });

    // 2. Add to purchases collection for review eligibility
    const pq = query(collection(db, 'purchases'), where('email', '==', currentUser.email));
    const psnap = await getDocs(pq);
    if (psnap.empty) {
      await addDoc(collection(db, 'purchases'), {
        email: currentUser.email,
        products: [currentProd.name],
      });
    } else {
      const pdoc = psnap.docs[0];
      const existing = pdoc.data().products || [];
      if (!existing.includes(currentProd.name)) {
        await updateDoc(pdoc.ref, { products: [...existing, currentProd.name] });
      }
    }

    // 3. Send EmailJS notification
    await emailjs.send(EJS_SERVICE, EJS_TEMPLATE, {
      to_email: 'noorproductions.as@gmail.com',
      buyer_name: orderData.buyerName,
      buyer_email: orderData.buyerEmail,
      product_name: orderData.productName,
      quantity: orderData.quantity,
      total_amount: '₹' + totalAmt.toLocaleString('en-IN'),
      ordered_at: orderData.orderedAt,
    });

    // 4. Restore button state, then show order confirmation
    buyBtns.forEach(btn => {
      btn.disabled = false;
      btn.textContent = btn.dataset.origText || '🛒 Buy Now';
      btn.style.opacity = '';
    });
    document.getElementById('orderFreezeOverlay').classList.remove('active');
    closeModalDirect();
    document.getElementById('orderDetailProduct').textContent = orderData.productName;
    document.getElementById('orderDetailQty').textContent = qty;
    document.getElementById('orderDetailAmount').textContent = '₹' + totalAmt.toLocaleString('en-IN');
    document.getElementById('orderDetailEmail').textContent = orderData.buyerEmail;
    document.getElementById('orderVeil').classList.add('open');

  } catch(err) {
    console.error('Order error:', err);
    // Restore button state on failure
    buyBtns.forEach(btn => {
      btn.disabled = false;
      btn.textContent = btn.dataset.origText || '🛒 Buy Now';
      btn.style.opacity = '';
    });
    document.getElementById('orderFreezeOverlay').classList.remove('active');
    toast('Something went wrong. Please try again ✿');
  }
}

function closeOrderModal() {
  document.getElementById('orderVeil').classList.remove('open');
}

// ═══════════════════════════════════════
// NETWORK ERROR FALLBACK
// ═══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // If Firebase never responds (no network, blocked, dead connection)
  // show a clear, branded error after 6 seconds instead of leaving
  // the user stuck staring at the intro screen with no explanation.
  setTimeout(() => {
    if (!_authResolved) {
      document.getElementById('introScreen').classList.add('hide');
      let netErr = document.getElementById('networkErrorScreen');
      if (!netErr) {
        netErr = document.createElement('div');
        netErr.id = 'networkErrorScreen';
        netErr.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:10002',
          'background:linear-gradient(160deg,#FDF8F4 0%,#F7E8E0 50%,#FDF8F4 100%)',
          'display:flex', 'align-items:center', 'justify-content:center', 'padding:24px'
        ].join(';');
        netErr.innerHTML = `
          <div style="text-align:center;max-width:360px;width:100%;">
            <div style="font-size:64px;margin-bottom:20px;">📡</div>
            <h2 style="font-family:'Playfair Display',serif;font-size:26px;color:#4A3728;font-weight:400;margin-bottom:10px;">
              It's not us — <em style="color:#D4897A;font-style:italic;">it's your network</em>
            </h2>
            <p style="font-family:'Dancing Script',cursive;font-size:20px;color:#C9956A;margin-bottom:20px;">
              Dream Boutique is perfectly fine ✿
            </p>
            <p style="font-size:13px;color:#9A7B6E;line-height:1.9;font-weight:300;margin-bottom:32px;">
              We couldn't connect to our servers. Please check your internet connection and try again — we'll be right here waiting for you.
            </p>
            <button onclick="location.reload()"
              style="background:#D4897A;color:#fff;border:none;padding:14px 36px;border-radius:100px;
              font-family:'Raleway',sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;
              font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(212,137,122,0.35);">
              Try Again
            </button>
            <p style="margin-top:20px;font-size:11px;color:#9A7B6E;opacity:0.6;font-style:italic;">
              If the problem persists, try switching from mobile data to Wi‑Fi or vice versa.
            </p>
          </div>
        `;
        document.body.appendChild(netErr);
      }
    }
  }, 6000);
});

function starsToDisplay(val){
  let s='';
  for(let i=1;i<=5;i++){
    if(val>=i) s+='★';
    else if(val>=i-0.5) s+='½';
    else s+='☆';
  }
  return `<span style="color:#F4A261;font-size:16px;">${s}</span> <span style="color:var(--text-light);font-size:12px;">(${val}/5)</span>`;
}

// ═══════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════
function handlePhotos(e){
  const prev=document.getElementById('previewRow');
  Array.from(e.target.files).forEach(f=>{const r=new FileReader();r.onload=ev=>{const i=document.createElement('img');i.src=ev.target.result;prev.appendChild(i);};r.readAsDataURL(f);});
}

async function submitReview(){
  if (!currentUser || currentUser.name === 'Guest') {
    document.getElementById('loginWall').classList.add('open');
    return;
  }
  const product = document.getElementById('fproduct').value;
  const ratingVal = document.getElementById('frating').value;
  const review = document.getElementById('freview').value.trim();
  if (!product) { toast('Please select a product ✿'); return; }
  if (!ratingVal) { toast('Please select a rating ✿'); return; }
  if (!review) { toast('Please write your review ✿'); return; }

  const rating = parseFloat(ratingVal);
  try {
    await saveReview({
      name: currentUser.name,
      email: currentUser.email,
      uid: currentUser.uid,
      product,
      rating,
      review,
    });
    const card = document.createElement('div');
    card.className = 'rcard fade-up';
    card.innerHTML = `<div class="rcard-quote">"</div><div class="rcard-stars">${starsToDisplay(rating)}</div><p class="rcard-text">${review}</p><p class="rcard-author">${currentUser.name}</p><p class="rcard-loc" style="font-size:11px;color:var(--text-light);margin-top:2px;">${product}</p>`;
    document.getElementById('reviewsGrid').prepend(card);
    setTimeout(() => card.classList.add('in'), 80);
    const sel = document.getElementById('fproduct');
    const opt = Array.from(sel.options).find(o => o.value === product);
    if (opt) opt.remove();
    const remaining = Array.from(sel.options).filter(o => o.value !== '').length;
    if (remaining === 0) {
      document.getElementById('feedbackForm').style.display = 'none';
      document.getElementById('successBox').style.display = 'block';
    } else {
      document.getElementById('freview').value = '';
      document.getElementById('frating').value = '';
      sel.value = '';
      toast('Review posted! ✿ You can review another item below.');
    }
  } catch(e) {
    toast('Could not save review. Please try again ✿');
  }
}

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
function toast(msg){
  const t=document.createElement('div');t.className='toast';t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),300);},2500);
}

function observeFades(){
  const obs=new IntersectionObserver((entries)=>{
    entries.forEach((e,i)=>{if(e.isIntersecting){setTimeout(()=>e.target.classList.add('in'),i*55);obs.unobserve(e.target);}});
  },{threshold:0.07});
  document.querySelectorAll('.fade-up:not(.in)').forEach(el=>obs.observe(el));
}

// Expose functions globally for onclick attributes and profile.js
window.signInWithGoogle = signInWithGoogle;
window.continueAsGuest = continueAsGuest;
window.toggleCart = toggleCart;
window.filterP = filterP;
window.openModal = openModal;
window.closeModal = closeModal;
window.closeModalDirect = closeModalDirect;
window.addToCart = addToCart;
window.addToCartFromModal = addToCartFromModal;
window.checkoutCart = checkoutCart;
window.submitReview = submitReview;
window.selectDevice = selectDevice;
window.changeQty = changeQty;
window.buyNow = buyNow;
window.closeOrderModal = closeOrderModal;
window.doLogout = doLogout;
window.toast = toast;
window.starsToDisplay = starsToDisplay;
window.getUserPurchases = getUserPurchases;
window.db = db;
window.collection = collection;
window.query = query;
window.where = where;
window.getDocs = getDocs;
window.currentUser_ref = () => currentUser;
