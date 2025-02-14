<template>



  <div class="py-8">
    <h2 class="text-3xl lg:text-4xl font-bold mb-12 text-gray-900">
      Contributors made <span class="text-orange-500">Nestri</span>
    </h2>
    <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-8 gap-4 sm:gap-5 lg:gap-6">
      <div
        v-for="(contributor, index) in contributors"
        :key="index"
        class="pt-[100%] relative"
      >
        <NuxtLink
          v-if="contributor.login"
          :key="contributor.login"
          :to="`https://github.com/${contributor.login}`"
          class="absolute inset-0 flex transition-all"
          :style="{
            'transition-delay': `${(index % 8 + Math.floor(index / 8)) * 20}ms`
          }"
        >
          <UTooltip class="w-full text-orange-500" :text="contributor.login">
            <NuxtImg
              :src="contributor.avatar_url"
              provider="ipx"
              densities="x1 x2"
              height="80px"
              width="80px"
              :alt="contributor.login"
              loading="lazy"
              class="rounded-xl w-full h-full transition lg:hover:scale-110"
            />
          </UTooltip>
          <span class="inline-block rounded-t px-1 bg-gray-950 text-white absolute -bottom-2 right-0 font-medium text-sm">
            <span class="font-light text-xs text-gray-400">#</span>{{ index + 1 }}
          </span>

        </NuxtLink>
        
      </div>
      
      
</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const contributors = ref([])

// Fetch contributors data from GitHub without authentication
const fetchContributors = async () => {
  try {
    const response = await fetch('https://api.github.com/repos/nestriness/nestri/contributors')
    if (!response.ok) throw new Error('Failed to fetch contributors')
    contributors.value = await response.json()
  } catch (error) {
    console.error('Error fetching contributors:', error)
  }
}

// Fetch contributors when component is mounted
onMounted(fetchContributors)
</script>
<style>
:hover.
</style>