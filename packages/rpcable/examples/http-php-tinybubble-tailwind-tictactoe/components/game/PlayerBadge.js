export default {
    name: 'PlayerBadge',
    props: ['panel'],
    template() {
        return /*html*/`
        <div class="min-w-0 text-center">
            <div :class="panel.avatarClass" class="mx-auto grid h-12 w-12 place-items-center rounded-full border-[3px] border-white text-xl font-black text-white shadow">
                {{ panel.symbol }}
            </div>
            <div :class="panel.nameClass" class="mt-2 truncate text-[18px] font-black leading-none">{{ panel.displayName }}</div>
            <div :class="panel.scoreClass" class="mt-1 text-[11px] font-bold">Score {{ panel.score }}</div>
        </div>
        `;
    },
};
