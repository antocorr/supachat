export default {
    name: 'StatusRibbon',
    props: ['banner'],
    template() {
        return /*html*/`
        <div class="winner-pill mx-auto -mt-3 w-fit max-w-[15rem] rounded-2xl border border-white/30 px-5 py-2 text-center text-[24px] font-black tracking-tight text-white">
            {{ banner.text }}
        </div>
        `;
    },
};
