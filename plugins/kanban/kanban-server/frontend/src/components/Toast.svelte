<script lang="ts">
  import { fly } from "svelte/transition";

  let { message }: { message: string } = $props();
</script>

<div class="toast" transition:fly={{ y: 50, duration: 200 }}>
  {message}
</div>
