/* ========================================
   LifeOS – Immersive Narrative Experience
   JavaScript Controller
   ======================================== */

// ============ State Management ============
const state = {
  currentAct: 0,
  audioEnabled: false,
  audioInitialized: false,
  overrideTriggered: false,
  scrollProgress: 0
};

// ============ DOM Elements ============
const elements = {
  audioToggle: document.getElementById('audio-toggle'),
  progressFill: document.getElementById('progress-fill'),
  overrideText: document.getElementById('override-text'),
  systemResponse: document.getElementById('system-response'),
  sections: document.querySelectorAll('.section'),
  actSections: document.querySelectorAll('.section-act'),
  reveals: document.querySelectorAll('.reveal'),
  metrics: document.querySelectorAll('.metric')
};

// ============ Audio System ============
const audioSystem = {
  context: null,
  masterGain: null,
  tracks: {},
  currentTrack: null,
  
  async init() {
    if (state.audioInitialized) return;
    
    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.context.createGain();
      this.masterGain.connect(this.context.destination);
      this.masterGain.gain.value = 0.5;
      
      // Define audio tracks (users will add these files)
      this.tracks = {
        1: { src: 'audio/act1-ambient.mp3', buffer: null, source: null, gain: null },
        2: { src: 'audio/act2-ambient.mp3', buffer: null, source: null, gain: null },
        3: { src: 'audio/act3-ambient.mp3', buffer: null, source: null, gain: null }
      };
      
      state.audioInitialized = true;
      console.log('Audio system initialized');
    } catch (e) {
      console.warn('Audio system unavailable:', e);
    }
  },
  
  async loadTrack(actNum) {
    const track = this.tracks[actNum];
    if (!track || track.buffer || track.failed) return;
    
    try {
      const response = await fetch(track.src);
      if (!response.ok) {
        track.failed = true;
        return; // Silently fail - ambient audio is optional
      }
      const arrayBuffer = await response.arrayBuffer();
      track.buffer = await this.context.decodeAudioData(arrayBuffer);
    } catch (e) {
      track.failed = true;
      // Silently fail - ambient audio is optional
    }
  },
  
  async playTrack(actNum) {
    if (!state.audioEnabled || !this.context) return;
    
    await this.loadTrack(actNum);
    const track = this.tracks[actNum];
    
    if (!track || !track.buffer) return;
    
    // Fade out current track
    if (this.currentTrack && this.tracks[this.currentTrack]) {
      const oldTrackNum = this.currentTrack; // Capture before it changes
      const currentGain = this.tracks[oldTrackNum].gain;
      if (currentGain) {
        currentGain.gain.linearRampToValueAtTime(0, this.context.currentTime + 1);
        setTimeout(() => {
          if (this.tracks[oldTrackNum]?.source) {
            try {
              this.tracks[oldTrackNum].source.stop();
            } catch (e) {} // Ignore if already stopped
          }
        }, 1100);
      }
    }
    
    // Create and play new track
    track.source = this.context.createBufferSource();
    track.source.buffer = track.buffer;
    track.source.loop = true;
    
    track.gain = this.context.createGain();
    track.gain.gain.value = 0;
    
    track.source.connect(track.gain);
    track.gain.connect(this.masterGain);
    
    track.source.start();
    track.gain.gain.linearRampToValueAtTime(1, this.context.currentTime + 1);
    
    this.currentTrack = actNum;
  },
  
  stopAll() {
    Object.values(this.tracks).forEach(track => {
      if (track.source) {
        try {
          track.source.stop();
        } catch (e) {}
      }
    });
    this.currentTrack = null;
  },
  
  toggle() {
    state.audioEnabled = !state.audioEnabled;
    document.body.classList.toggle('audio-muted', !state.audioEnabled);
    
    if (state.audioEnabled) {
      this.init();
      if (this.context?.state === 'suspended') {
        this.context.resume();
      }
      if (state.currentAct > 0) {
        this.playTrack(state.currentAct);
      }
      ttsSystem.setMuted(false);
      ttsSystem.onAudioEnabled();
    } else {
      this.stopAll();
      ttsSystem.stopAll();
      ttsSystem.setMuted(true);
    }
  }
};

// ============ Scroll Observer ============
const scrollObserver = {
  observer: null,
  actObserver: null,
  sceneObserver: null,
  overrideObserver: null,
  
  init() {
    // Observer for reveal animations
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            
            // Animate metrics when they become visible
            if (entry.target.classList.contains('metrics-display')) {
              this.animateMetrics(entry.target);
            }
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -10% 0px'
      }
    );
    
    // Observer for the override scene (typewriter trigger)
    this.overrideObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
            console.log('🎬 Override scene visible, starting typewriter in 1s');
            setTimeout(() => typewriterEffect.start(), 1000);
          }
        });
      },
      {
        threshold: [0.3, 0.5],
        rootMargin: '0px'
      }
    );
    
    // Observe the override scene
    const overrideScene = document.getElementById('override-scene');
    if (overrideScene) {
      this.overrideObserver.observe(overrideScene);
    }
    
    // Observer for act sections
    this.actObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const actNum = parseInt(entry.target.dataset.act);
          
          if (entry.isIntersecting && entry.intersectionRatio > 0.1) {
            this.activateAct(actNum, entry.target);
          } else if (!entry.isIntersecting) {
            entry.target.classList.remove('active');
          }
        });
      },
      {
        threshold: [0, 0.1, 0.5, 0.9],
        rootMargin: '-10% 0px -10% 0px'
      }
    );
    
    // Observer for scenes within acts (for background transitions)
    this.sceneObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
            const sceneNum = entry.target.dataset.scene;
            const parentAct = entry.target.closest('.section-act');
            
            if (parentAct && sceneNum) {
              parentAct.setAttribute('data-active-scene', sceneNum);
            }
          }
        });
      },
      {
        threshold: [0.3, 0.5, 0.7],
        rootMargin: '-20% 0px -20% 0px'
      }
    );
    
    // Observe reveal elements
    elements.reveals.forEach(el => this.observer.observe(el));
    
    // Observe act sections
    elements.actSections.forEach(el => this.actObserver.observe(el));
    
    // Observe scenes within acts (including act headers)
    document.querySelectorAll('[data-scene]').forEach(el => {
      this.sceneObserver.observe(el);
    });
  },
  
  activateAct(actNum, element) {
    // Deactivate other acts
    elements.actSections.forEach(act => {
      if (act !== element) {
        act.classList.remove('active');
      }
    });
    
    element.classList.add('active');
    
    // Set default active scene to 0 (intro) if not set
    if (!element.hasAttribute('data-active-scene')) {
      element.setAttribute('data-active-scene', '0');
    }
    
    if (state.currentAct !== actNum) {
      state.currentAct = actNum;
      document.body.setAttribute('data-act', actNum);
      
      // Play audio for this act
      audioSystem.playTrack(actNum);
      
      // Note: Typewriter is now triggered by the override scene observer, not here
    }
  },
  
  animateMetrics(container) {
    const metrics = container.querySelectorAll('.metric');
    metrics.forEach((metric, index) => {
      const value = parseInt(metric.dataset.value) || 0;
      const fill = metric.querySelector('.metric-fill');
      
      if (fill) {
        setTimeout(() => {
          fill.style.width = `${value * 10}%`;
        }, index * 100);
      }
    });
  }
};

// ============ Progress Tracker ============
const progressTracker = {
  init() {
    window.addEventListener('scroll', this.update.bind(this), { passive: true });
  },
  
  update() {
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollTop = window.scrollY;
    state.scrollProgress = (scrollTop / scrollHeight) * 100;
    
    elements.progressFill.style.width = `${state.scrollProgress}%`;
  }
};

// ============ Typewriter Effect ============
const typewriterEffect = {
  text: "Stop, I don't want this.",
  index: 0,
  
  start() {
    console.log('⌨️ Typewriter start() called, overrideTriggered =', state.overrideTriggered);
    if (state.overrideTriggered) {
      console.log('⌨️ Typewriter blocked - already triggered');
      return;
    }
    state.overrideTriggered = true;
    
    this.index = 0;
    elements.overrideText.textContent = '';
    console.log('⌨️ Typewriter starting to type...');
    this.type();
  },
  
  type() {
    if (this.index < this.text.length) {
      elements.overrideText.textContent += this.text[this.index];
      this.index++;
      setTimeout(() => this.type(), 80 + Math.random() * 40);
    } else {
      // Show system response after typing completes
      console.log('⌨️ Typewriter finished typing, scheduling showResponse in 800ms');
      setTimeout(() => this.showResponse(), 800);
    }
  },
  
  showResponse() {
    console.log('📺 showResponse() called');
    elements.systemResponse.classList.add('visible');
    
    // Animate response lines sequentially
    const lines = elements.systemResponse.querySelectorAll('.response-line');
    lines.forEach((line, index) => {
      line.style.opacity = '0';
      line.style.transform = 'translateY(10px)';
      
      setTimeout(() => {
        line.style.transition = 'all 0.4s ease';
        line.style.opacity = '1';
        line.style.transform = 'translateY(0)';
      }, index * 600);
    });
    
    // Play the override TTS (force play, bypassing normal checks)
    console.log('🔊 Scheduling act3Override TTS in 800ms');
    setTimeout(() => {
      console.log('🔊 Calling forcePlay("act3Override")');
      ttsSystem.forcePlay('act3Override');
    }, 800);
  }
};

// ============ Parallax Effect ============
const parallax = {
  init() {
    window.addEventListener('scroll', this.update.bind(this), { passive: true });
  },
  
  update() {
    const scrollY = window.scrollY;
    
    elements.actSections.forEach(section => {
      if (!section.classList.contains('active')) return;
      
      const bg = section.querySelector('.act-background');
      if (bg) {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;
        const relativeScroll = scrollY - sectionTop;
        const parallaxOffset = relativeScroll * 0.3;
        
        // Clamp the parallax offset
        const maxOffset = sectionHeight * 0.15;
        const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, parallaxOffset));
        
        bg.style.transform = `translateY(${clampedOffset}px) scale(1.1)`;
      }
    });
  }
};

// ============ Glitch Effect ============
const glitchEffect = {
  elements: [],
  
  init() {
    // Apply glitch data attributes to titles in Act 3
    const act3Titles = document.querySelectorAll('.act-3 .act-title, .act-3 .scene-title');
    act3Titles.forEach(el => {
      el.classList.add('glitch');
      el.setAttribute('data-text', el.textContent);
    });
  }
};

// ============ TTS (Text-to-Speech) System ============
// SIMPLE DESIGN: Each TTS plays once when its section becomes active.
// No replay, no complex cooldowns - just clean, predictable behavior.
const ttsSystem = {
  audios: {},           // Audio elements by track name
  currentTrack: null,   // Currently playing track name
  playedTracks: new Set(), // Tracks that have played this session
  forcePlaying: false,  // True when a force-played TTS should not be interrupted
  
  init() {
    // Create audio elements
    const tracks = [
      'act1Instruction',
      'act2Instruction', 
      'act3Instruction',
      'act3Override',
      'act3Outcome'
    ];
    
    tracks.forEach(name => {
      const audio = new Audio(`audio/${this.nameToFile(name)}.mp3`);
      audio.preload = 'auto';
      audio.volume = 0.85;
      
      // When audio ends naturally, clear current track
      audio.addEventListener('ended', () => {
        if (this.currentTrack === name) {
          this.currentTrack = null;
        }
      });
      
      this.audios[name] = audio;
    });
    
    // Set up scroll-based TTS detection
    this.setupScrollDetection();
  },
  
  nameToFile(name) {
    // Convert camelCase to kebab-case: act1Instruction -> act1-instruction
    return name.replace(/([A-Z])/g, '-$1').toLowerCase();
  },
  
  setupScrollDetection() {
    // Simple scroll listener - check which TTS section is active
    let ticking = false;
    
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.checkActiveTTS();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  },
  
  checkActiveTTS() {
    if (!state.audioEnabled) return;
    
    const viewportCenter = window.innerHeight / 2;
    let activeTrack = null;
    
    // Find which TTS element is closest to viewport center
    document.querySelectorAll('[data-tts]').forEach(el => {
      const rect = el.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      
      // Element is "active" if its center is within the middle 60% of viewport
      if (rect.top < window.innerHeight * 0.7 && rect.bottom > window.innerHeight * 0.3) {
        activeTrack = el.dataset.tts;
      }
    });
    
    // If active track changed, handle it
    if (activeTrack && activeTrack !== this.currentTrack) {
      this.play(activeTrack);
    } else if (!activeTrack && this.currentTrack) {
      this.stop();
    }
  },
  
  play(trackName) {
    if (!state.audioEnabled) return;
    if (!this.audios[trackName]) return;
    
    // Don't interrupt a force-played TTS
    if (this.forcePlaying) {
      console.log('TTS play blocked - forcePlaying active:', trackName);
      return;
    }
    
    // Already playing this track
    if (this.currentTrack === trackName) return;
    
    // Already played this session - don't replay
    if (this.playedTracks.has(trackName)) return;
    
    // Stop any current TTS first
    this.stop();
    
    // Play the new track
    const audio = this.audios[trackName];
    audio.currentTime = 0;
    
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        this.currentTrack = trackName;
        this.playedTracks.add(trackName);
        console.log('TTS playing:', trackName);
      }).catch(e => {
        console.warn('TTS play failed:', e);
      });
    }
  },
  
  stop() {
    // Don't stop if forcePlaying is active
    if (this.forcePlaying) {
      console.log('TTS stop blocked - forcePlaying active');
      return;
    }
    
    if (this.currentTrack && this.audios[this.currentTrack]) {
      const audio = this.audios[this.currentTrack];
      audio.pause();
      audio.currentTime = 0;
      console.log('TTS stopped:', this.currentTrack);
    }
    this.currentTrack = null;
  },
  
  // Force play a track (bypasses playedTracks check) - for programmatic triggers
  forcePlay(trackName) {
    console.log('🔊 forcePlay() called for:', trackName);
    
    if (!state.audioEnabled) {
      console.log('🔊 BLOCKED: audio not enabled');
      return;
    }
    if (!this.audios[trackName]) {
      console.log('🔊 BLOCKED: audio not found');
      return;
    }
    
    // Stop any current TTS (temporarily disable forcePlaying protection)
    this.forcePlaying = false;
    this.stop();
    
    const audio = this.audios[trackName];
    audio.currentTime = 0;
    
    // Set forcePlaying to protect this TTS from scroll interruption
    this.forcePlaying = true;
    
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        this.currentTrack = trackName;
        this.playedTracks.add(trackName);
        console.log('🔊 SUCCESS: TTS force playing:', trackName);
      }).catch(e => {
        console.warn('🔊 FAILED: TTS force play failed:', e);
        this.forcePlaying = false;
      });
    }
    
    // Clear forcePlaying when audio ends
    audio.addEventListener('ended', () => {
      console.log('🔊 Force-played TTS ended:', trackName);
      this.forcePlaying = false;
      this.currentTrack = null;
    }, { once: true });
  },
  
  // Called when audio is toggled on - check if we should play something
  onAudioEnabled() {
    setTimeout(() => this.checkActiveTTS(), 100);
  },
  
  stopAll() {
    this.stop();
  },
  
  setMuted(muted) {
    Object.values(this.audios).forEach(audio => {
      audio.muted = muted;
    });
  },
  
  // Reset for new session (if needed)
  reset() {
    this.stop();
    this.playedTracks.clear();
  }
};

// ============ Visual Effects ============
const visualEffects = {
  init() {
    // Scanlines
    const scanlines = document.createElement('div');
    scanlines.className = 'scanlines';
    document.body.appendChild(scanlines);
    
    // Vignette
    const vignette = document.createElement('div');
    vignette.className = 'vignette';
    document.body.appendChild(vignette);
    
    // Noise texture
    const noise = document.createElement('div');
    noise.className = 'noise';
    document.body.appendChild(noise);
    
    // Floating particles
    this.createParticles();
  },
  
  createParticles() {
    const container = document.createElement('div');
    container.className = 'particles';
    
    for (let i = 0; i < 30; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.animationDelay = `${Math.random() * 20}s`;
      particle.style.animationDuration = `${15 + Math.random() * 15}s`;
      container.appendChild(particle);
    }
    
    document.body.appendChild(container);
  }
};

// ============ Initialize ============
document.addEventListener('DOMContentLoaded', () => {
  // Initialize all systems
  scrollObserver.init();
  progressTracker.init();
  parallax.init();
  glitchEffect.init();
  visualEffects.init();
  ttsSystem.init();
  
  // Audio toggle
  elements.audioToggle.addEventListener('click', () => {
    audioSystem.toggle();
  });
  
  // Start with audio muted
  document.body.classList.add('audio-muted');
  
  // Trigger initial reveals for opening section
  setTimeout(() => {
    const openingReveals = document.querySelectorAll('.section-opening .reveal');
    openingReveals.forEach(el => el.classList.add('visible'));
  }, 300);
  
  console.log('LifeOS Experience initialized');
});

// ============ Smooth Scroll for Internal Links ============
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// ============ Keyboard Navigation ============
document.addEventListener('keydown', (e) => {
  // M key toggles audio
  if (e.key.toLowerCase() === 'm') {
    audioSystem.toggle();
  }
  
  // Space key scrolls down when not in input
  if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
  }
});

// ============ Scene Navigation ============
const sceneNav = {
  prevBtn: document.getElementById('nav-prev'),
  nextBtn: document.getElementById('nav-next'),
  breakpoints: [],
  currentIndex: 0,
  
  init() {
    if (!this.prevBtn || !this.nextBtn) return;
    
    // Collect all scene breakpoints (sections and scene articles)
    this.breakpoints = [
      document.getElementById('opening'),
      ...document.querySelectorAll('.section-act > .act-header'),
      ...document.querySelectorAll('.scene'),
      document.getElementById('epilogue')
    ].filter(el => el !== null);
    
    // Sort by DOM position
    this.breakpoints.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return (rectA.top + window.scrollY) - (rectB.top + window.scrollY);
    });
    
    // Event listeners
    this.prevBtn.addEventListener('click', () => this.goToPrev());
    this.nextBtn.addEventListener('click', () => this.goToNext());
    
    // Update on scroll
    window.addEventListener('scroll', () => this.updateButtons(), { passive: true });
    this.updateButtons();
  },
  
  getCurrentIndex() {
    const scrollY = window.scrollY + window.innerHeight * 0.3;
    let index = 0;
    
    for (let i = 0; i < this.breakpoints.length; i++) {
      const rect = this.breakpoints[i].getBoundingClientRect();
      const top = rect.top + window.scrollY;
      if (scrollY >= top) {
        index = i;
      }
    }
    
    return index;
  },
  
  updateButtons() {
    this.currentIndex = this.getCurrentIndex();
    this.prevBtn.disabled = this.currentIndex === 0;
    this.nextBtn.disabled = this.currentIndex >= this.breakpoints.length - 1;
  },
  
  goToPrev() {
    const currentIndex = this.getCurrentIndex();
    if (currentIndex > 0) {
      this.scrollToBreakpoint(currentIndex - 1);
    }
  },
  
  goToNext() {
    const currentIndex = this.getCurrentIndex();
    if (currentIndex < this.breakpoints.length - 1) {
      this.scrollToBreakpoint(currentIndex + 1);
    }
  },
  
  scrollToBreakpoint(index) {
    const target = this.breakpoints[index];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
};

// Initialize scene navigation
document.addEventListener('DOMContentLoaded', () => {
  sceneNav.init();
});

// ============ Visibility Change (Pause Audio) ============
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.audioEnabled) {
    audioSystem.masterGain?.gain.linearRampToValueAtTime(0, audioSystem.context?.currentTime + 0.3);
  } else if (!document.hidden && state.audioEnabled) {
    audioSystem.masterGain?.gain.linearRampToValueAtTime(0.5, audioSystem.context?.currentTime + 0.3);
  }
});

// ============ Terms & Conditions Modal ============
// ============ Loading Screen ============
const loadingScreen = {
  screen: document.getElementById('loading-screen'),
  text: document.getElementById('loading-text'),
  status: document.getElementById('loading-status'),
  
  statusMessages: [
    'Initializing',
    'Scanning preferences',
    'Mapping neural patterns',
    'Calibrating optimization',
    'Syncing life parameters',
    'Connection established'
  ],
  
  show() {
    if (!this.screen) return;
    this.screen.classList.remove('hidden');
  },
  
  async runSequence() {
    // Run through status messages
    for (let i = 0; i < this.statusMessages.length; i++) {
      await this.delay(400 + Math.random() * 300);
      if (this.status) {
        this.status.textContent = this.statusMessages[i];
      }
    }
    
    // Final delay before hiding
    await this.delay(600);
    this.hide();
  },
  
  hide() {
    if (!this.screen) return;
    this.screen.classList.add('hidden');
    
    // Re-enable body scroll
    document.body.style.overflow = '';
    
    // Remove from DOM after fade
    setTimeout(() => {
      this.screen.remove();
    }, 800);
  },
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

const termsModal = {
  modal: document.getElementById('terms-modal'),
  body: document.getElementById('terms-body'),
  acceptBtn: document.getElementById('accept-terms'),
  scrollHint: document.getElementById('scroll-hint'),
  hasScrolledToBottom: false,
  
  init() {
    if (!this.modal || !this.body || !this.acceptBtn) return;
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    
    // Listen for scroll in terms body
    this.body.addEventListener('scroll', () => this.checkScroll());
    
    // Accept button click
    this.acceptBtn.addEventListener('click', () => this.accept());
    
    // Check initial scroll state
    this.checkScroll();
  },
  
  checkScroll() {
    const { scrollTop, scrollHeight, clientHeight } = this.body;
    const scrolledPercent = (scrollTop + clientHeight) / scrollHeight;
    
    // Enable button when scrolled to 90% or more
    if (scrolledPercent >= 0.9 && !this.hasScrolledToBottom) {
      this.hasScrolledToBottom = true;
      this.acceptBtn.disabled = false;
      this.scrollHint.classList.add('hidden');
    }
  },
  
  accept() {
    if (!this.hasScrolledToBottom) return;
    
    // Hide terms modal
    this.modal.classList.add('hidden');
    
    // Remove modal from DOM after animation
    setTimeout(() => {
      this.modal.remove();
    }, 500);
    
    // Show loading screen and run sequence
    loadingScreen.show();
    loadingScreen.runSequence();
  }
};

// Initialize terms modal
document.addEventListener('DOMContentLoaded', () => {
  termsModal.init();
});

