<script setup lang="ts">
import { withBase } from 'vitepress';
</script>

<template>
  <figure class="pb-browser">
    <div class="pb-browser-bar" aria-hidden="true">
      <span class="pb-dot" /><span class="pb-dot" /><span class="pb-dot" />
      <span class="pb-url">pr-42.your-app.pages.dev</span>
    </div>
    <img
      :src="withBase('/demo.gif')"
      width="800"
      height="500"
      alt="A reviewer picks the checkout button on a preview, signs in with GitHub, posts a comment, and a numbered pin appears on the button."
    />
  </figure>
</template>
