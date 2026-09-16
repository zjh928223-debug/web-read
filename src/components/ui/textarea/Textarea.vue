<script setup>
import { computed, ref, watch } from "vue";
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

const props = defineProps({
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
  defaultValue: { type: [String, Number], required: false },
  modelValue: { type: [String, Number], required: false },
  modelModifiers: { type: Object, required: false, default: () => ({}) },
});

const emits = defineEmits(["update:modelValue"]);

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
});

const isComposing = ref(false);
const rawTextareaValue = ref(null);
const textareaValue = computed(() => {
  if (rawTextareaValue.value !== null) return rawTextareaValue.value;
  return modelValue.value;
});

watch(modelValue, (value) => {
  if (isComposing.value || !props.modelModifiers.trim || rawTextareaValue.value === null) return;
  const normalized = typeof rawTextareaValue.value === "string" ? rawTextareaValue.value.trim() : rawTextareaValue.value;
  if (value !== normalized) rawTextareaValue.value = null;
});

function updateModelValue(event) {
  const value = event.target?.value;
  if (event.target?.composing) {
    rawTextareaValue.value = value;
    return;
  }
  if (props.modelModifiers.trim && typeof value === "string") {
    rawTextareaValue.value = value;
    modelValue.value = value.trim();
    return;
  }
  rawTextareaValue.value = null;
  modelValue.value = value;
}

function startComposition(event) {
  isComposing.value = true;
  rawTextareaValue.value = event.target.value;
  event.target.composing = true;
}

function endComposition(event) {
  if (!isComposing.value && !event.target?.composing) return;
  rawTextareaValue.value = event.target.value;
  isComposing.value = false;
  event.target.composing = false;
  event.target.dispatchEvent(new Event("input"));
}

function normalizeTrimmedValue(event) {
  if (!props.modelModifiers.trim || typeof event.target?.value !== "string") return;
  const normalized = event.target.value.trim();
  rawTextareaValue.value = null;
  event.target.value = normalized;
  modelValue.value = normalized;
}

function handleChange(event) {
  endComposition(event);
  normalizeTrimmedValue(event);
}
</script>

<template>
  <textarea
    :value="textareaValue"
    @input="updateModelValue"
    @compositionstart="startComposition"
    @compositionend="endComposition"
    data-slot="textarea"
    @change="handleChange"
    :class="
      cn(
        'rw:border-input rw:placeholder:text-muted-foreground rw:focus-visible:border-ring rw:focus-visible:ring-ring/50 rw:aria-invalid:ring-destructive/20 rw:dark:aria-invalid:ring-destructive/40 rw:aria-invalid:border-destructive rw:dark:bg-input/30 rw:flex rw:field-sizing-content rw:min-h-16 rw:w-full rw:rounded-md rw:border rw:bg-transparent rw:px-3 rw:py-2 rw:text-base rw:shadow-xs rw:transition-[color,box-shadow] rw:outline-none rw:focus-visible:ring-3 rw:disabled:cursor-not-allowed rw:disabled:opacity-50 rw:md:text-sm',
        props.class,
      )
    "
  />
</template>
