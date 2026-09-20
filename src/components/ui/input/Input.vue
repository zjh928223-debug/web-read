<script setup>
import { computed, ref, watch } from "vue";
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";
import { inputVariants } from "./input-styles.js";

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
    :class="cn(inputVariants(), props.class)"
  />
</template>
