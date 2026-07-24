export default {
    name: 'BoardGrid',
    props: ['cells'],
    emits: ['play'],
    template() {
        return /*html*/`
        <div class="grid-board">
            <button x-for="cell in cells" type="button" class="board-cell" :disabled="cell.disabled" @click="playCell(cell.index)">
                <div :class="cell.markClass"></div>
            </button>
        </div>
        `;
    },
    playCell(index) {
        this.emit('play', { index });
    },
};
