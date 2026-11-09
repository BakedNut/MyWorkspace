package kr.myworkspace.wol;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/wol/devices")
class WolController {
  final WolService service;

  WolController(WolService service) {
    this.service = service;
  }

  @GetMapping
  Object list() {
    return service.list();
  }

  @PutMapping
  Object save(@RequestBody @NotNull @Size(max = 50) List<@Valid WolDevice> input) {
    return service.save(input);
  }

  record Mac(@Size(max = 32) String mac) {}

  @PatchMapping("/{id}/mac")
  Object mac(@PathVariable String id, @Valid @RequestBody Mac input) {
    return service.mac(id, input.mac());
  }

  @PostMapping("/{id}/wake")
  Object wake(@PathVariable String id) {
    return service.wake(id);
  }
}
