<script setup>
import { computed, ref, watch } from "vue";
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

const props = defineProps({
  defaultValue: { type: [String, Number], required: false },
  modelValue: { type: [String, Number], required: false },
  modelModifiers: { type: Object, required: false, default: () => ({}) },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
});

const emits = defineEmits(["update:modelValue"]);

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
});

const isComposing = ref(false);
const rawInputValue = ref(null);
const inputValue = computed(() => {
  if (rawInputValue.value !== null) return rawInputValue.value;
  return modelValue.value;
});

watch(modelValue, (value) => {
  if (isComposing.value || !props.modelModifiers.trim || rawInputValue.value === null) return;
  const normalized = typeof rawInputValue.value === "string" ? rawInputValue.value.trim() : rawInputValue.value;
  if (value !== normalized) rawInputValue.value = null;
});

function updateModelValue(event) {
  const value = event.target?.value;
  if (event.target?.composing) {
    rawInputValue.value = value;
    return;
  }
  if (props.modelModifiers.trim && typeof value === "string") {
    rawInputValue.value = value;
    modelValue.value = value.trim();
    return;
  }
  rawInputValue.value = null;
  modelValue.value = value;
}

function startComposition(event) {
  isComposing.value = true;
  rawInputValue.value = event.target.value;
  event.target.composing = true;
}

function endComposition(event) {
  if (!isComposing.value && !event.target?.composing) return;
  rawInputValue.value = event.target.value;
  isComposing.value = false;
  event.target.composing = false;
  event.target.dispatchEvent(new Event("input"));
}

function normalizeTrimmedValue(event) {
  if (!props.modelModifiers.trim || typeof event.target?.value !== "string") return;
  const normalized = event.target.value.trim();
  rawInputValue.value = null;
  event.target.value = normalized;
  modelValue.value = normalized;
}

function handleChange(event) {
  endComposition(event);
  normalizeTrimmedValue(event);
}
</script>

<template>
  <input
    :value="inputValue"
    @input="updateModelValue"
    @compositionstart="startComposition"
    @compositionend="endComposition"
    data-slot="input"
    @change="handleChange"
    :class="
      cn(
        'rw:file:text-foreground rw:placeholder:text-muted-foreground rw:selection:bg-primary rw:selection:text-primary-foreground rw:dark:bg-input/30 rw:border-input rw:h-9 rw:w-full rw:min-w-0 rw:rounded-md rw:border rw:bg-transparent rw:px-3 rw:py-1 rw:text-base rw:shadow-xs rw:transition-[color,box-shadow] rw:outline-none rw:file:inline-flex rw:file:h-7 rw:file:border-0 rw:file:bg-transparent rw:file:text-sm rw:file:font-medium rw:disabled:pointer-events-none rw:disabled:cursor-not-allowed rw:disabled:opacity-50 rw:md:text-sm',
        'rw:focus-visible:border-ring rw:focus-visible:ring-ring/50 rw:focus-visible:ring-3',
        'rw:aria-invalid:ring-destructive/20 rw:dark:aria-invalid:ring-destructive/40 rw:aria-invalid:border-destructive',
        props.class,
      )
    "
  />
</template>
