<template>
    <div>
      <NuxtLink v-if="logo.light && logo.dark" class="flex">
        <img :src="logo.light" class="h-7 dark:hidden" />
        <img :src="logo.dark" class="hidden h-7 dark:block" />
        <span v-if="showTitle && title" class="ml-3 self-center font-bold">
           {{ title }}
        </span>
      </NuxtLink>
    </div>
  </template>
  
  <script setup lang="ts">
  const { logo, title, showTitle } = useConfig().value.header;
  </script>