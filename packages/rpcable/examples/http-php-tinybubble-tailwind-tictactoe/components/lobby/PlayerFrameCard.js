export default {
    name: 'PlayerFrameCard',
    props: ['title', 'caption', 'seatLabel', 'src', 'captionClass', 'nameClass'],
    template() {
        return /*html*/`
        <section class="arena-side flex flex-col items-center justify-center px-6 py-8">
            <div class="relative z-[2] mb-5 text-center">
                <div :class="captionClass" class="text-[11px] font-bold uppercase tracking-[0.35em]">{{ caption }}</div>
                <div :class="nameClass" class="text-4xl font-black tracking-tight md:text-5xl">{{ title }}</div>
            </div>

            <div class="phone-shell">
                <div class="side-button b1"></div>
                <div class="side-button b2"></div>
                <div class="side-button-right"></div>
                <div class="phone-screen">
                    <div class="island"><div class="camera"></div></div>
                    <iframe class="h-full w-full rounded-[34px] border-0 bg-transparent" :src="src" :title="title + ' ' + seatLabel"></iframe>
                </div>
            </div>
        </section>
        `;
    },
};
