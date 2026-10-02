/* Global shared Vue components */
(function () {
  const { defineComponent, h } = Vue;

  const Ic = defineComponent({
    name: "Ic",
    props: { name: { type: String, required: true }, size: { type: [String, Number], default: "" } },
    computed: {
      path() {
        const icons = window.__ICONS__ || {};
        const p = icons[this.name] || icons["dot"] || "";
        return p;
      },
      cls() {
        const s = String(this.size);
        if (s === "14") return "ic-14";
        if (s === "18") return "ic-18";
        if (s === "20") return "ic-20";
        if (s === "28") return "ic-28";
        return "";
      },
    },
    template: `<i class="ic" :class="cls"><svg viewBox="0 0 24 24" v-html="path"></svg></i>`,
  });

  const Modal = defineComponent({
    name: "Modal",
    props: { title: String, width: { type: String, default: "520px" } },
    emits: ["close"],
    template: `
      <div class="modal-mask" @click.self="$emit('close')">
        <div class="modal" :style="{ width: width }">
          <div class="m-hd"><span>{{ title }}</span><ic name="x" size="18" style="cursor:pointer" @click="$emit('close')"></ic></div>
          <div class="m-bd"><slot></slot></div>
          <div class="m-ft" v-if="$slots.footer"><slot name="footer"></slot></div>
        </div>
      </div>`,
  });

  window.AppComponents = { Ic, Modal };
})();
