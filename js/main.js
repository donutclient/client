// Gallery carousel
const galleryContainer = document.getElementById('gallery-container');
const galleryPrev = document.getElementById('gallery-prev');
const galleryNext = document.getElementById('gallery-next');
const galleryDots = document.getElementById('gallery-dots');
const galleryItems = document.querySelectorAll('.gallery-item');

if (galleryContainer && galleryItems.length > 0) {
    galleryItems.forEach((_, index) => {
        const dot = document.createElement('button');
        dot.className = `w-2 h-2 rounded-full transition-all duration-300 ${index === 0 ? 'bg-primary w-6' : 'bg-outline-variant/40'}`;
        dot.addEventListener('click', () => {
            const scrollAmount = galleryItems[index].offsetLeft - galleryContainer.offsetLeft - 32;
            galleryContainer.scrollTo({left: scrollAmount, behavior: 'smooth'});
        });
        galleryDots.appendChild(dot);
    });

    const updateDots = () => {
        const scrollLeft = galleryContainer.scrollLeft;
        const itemWidth = galleryItems[0].offsetWidth + 24;
        const activeIndex = Math.round(scrollLeft / itemWidth);
        const dots = galleryDots.querySelectorAll('button');
        dots.forEach((dot, index) => {
            if (index === activeIndex) {
                dot.classList.add('bg-primary', 'w-6');
                dot.classList.remove('bg-outline-variant/40');
            } else {
                dot.classList.remove('bg-primary', 'w-6');
                dot.classList.add('bg-outline-variant/40');
            }
        });
    };

    galleryContainer.addEventListener('scroll', updateDots);

    galleryNext.addEventListener('click', () => {
        const itemWidth = galleryItems[0].offsetWidth + 24;
        galleryContainer.scrollBy({left: itemWidth, behavior: 'smooth'});
    });

    galleryPrev.addEventListener('click', () => {
        const itemWidth = galleryItems[0].offsetWidth + 24;
        galleryContainer.scrollBy({left: -itemWidth, behavior: 'smooth'});
    });

    const lightbox = document.getElementById('lightbox');
    const lightboxImage = document.getElementById('lightbox-img');
    const lightboxClose = document.getElementById('lightbox-close');
    let isZoomed = false;

    galleryItems.forEach(item => {
        item.addEventListener('click', () => {
            lightboxImage.src = item.querySelector('img').src;
            lightbox.classList.remove('hidden');
            lightbox.classList.add('flex');
            document.body.style.overflow = 'hidden';
        });
    });

    const closeLightbox = () => {
        lightbox.classList.add('hidden');
        lightbox.classList.remove('flex');
        document.body.style.overflow = '';
        lightboxImage.style.transform = 'scale(1)';
        lightboxImage.classList.remove('cursor-zoom-out');
        lightboxImage.classList.add('cursor-zoom-in');
        isZoomed = false;
    };

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', event => {
        if (event.target === lightbox || event.target.id === 'lightbox-container') {
            closeLightbox();
        }
    });

    lightboxImage.addEventListener('click', event => {
        event.stopPropagation();
        if (!isZoomed) {
            lightboxImage.style.transform = 'scale(1.5)';
            lightboxImage.classList.remove('cursor-zoom-in');
            lightboxImage.classList.add('cursor-zoom-out');
            isZoomed = true;
        } else {
            lightboxImage.style.transform = 'scale(1)';
            lightboxImage.classList.remove('cursor-zoom-out');
            lightboxImage.classList.add('cursor-zoom-in');
            isZoomed = false;
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeLightbox();
    });
}
