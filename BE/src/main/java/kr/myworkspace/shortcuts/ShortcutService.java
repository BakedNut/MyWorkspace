package kr.myworkspace.shortcuts;

import java.net.URI;
import java.util.HashSet;
import java.util.Set;
import kr.myworkspace.common.document.DocumentStore;
import kr.myworkspace.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class ShortcutService {
  final DocumentStore docs;

  ShortcutService(DocumentStore docs) {
    this.docs = docs;
  }

  ShortcutBoard get() {
    return docs.read("shortcuts", ShortcutBoard.class);
  }

  @Transactional
  ShortcutBoard save(ShortcutBoard input) {
    Set<String> groupIds = new HashSet<>();
    Set<String> linkIds = new HashSet<>();
    var groups =
        input.groups().stream()
            .map(
                group -> {
                  ApiException.require(groupIds.add(group.id()), "분류 ID가 중복되었습니다.");
                  var links =
                      group.links().stream()
                          .map(
                              link -> {
                                ApiException.require(linkIds.add(link.id()), "바로가기 ID가 중복되었습니다.");
                                String url = link.url().strip();
                                try {
                                  var uri = URI.create(url);
                                  ApiException.require(
                                      ("https".equalsIgnoreCase(uri.getScheme())
                                              || "http".equalsIgnoreCase(uri.getScheme()))
                                          && uri.getHost() != null
                                          && browserHost(uri.getHost())
                                          && uri.getRawUserInfo() == null
                                          && uri.getPort() >= -1
                                          && uri.getPort() <= 65535,
                                      "http 또는 https 사이트 주소를 입력하세요.");
                                } catch (IllegalArgumentException error) {
                                  throw new ApiException(400, "VALIDATION", "올바른 사이트 주소를 입력하세요.");
                                }
                                return new ShortcutBoard.Link(link.id(), name(link.name()), url);
                              })
                          .toList();
                  return new ShortcutBoard.Group(
                      group.id(), name(group.name()), group.collapsed(), links);
                })
            .toList();
    ApiException.require(linkIds.size() <= 200, "바로가기는 최대 200개까지 저장할 수 있습니다.");
    var document = docs.lock("shortcuts");
    var current = docs.read(document, ShortcutBoard.class);
    if (input.revision() != current.revision())
      throw new ApiException(409, "CONFLICT", "다른 화면에서 바로가기가 변경됐습니다. 최신 목록을 불러온 뒤 다시 시도하세요.");
    var saved = new ShortcutBoard(current.revision() + 1, groups);
    docs.write(document, saved);
    return saved;
  }

  // Match the URL Standard's numeric-host bounds without resolving the address.
  private boolean browserHost(String host) {
    if (host.contains("%")) return false;
    String[] parts = host.replaceFirst("\\.$", "").split("\\.", -1);
    String last = parts[parts.length - 1];
    if (!last.matches("[0-9]+|0[xX][0-9a-fA-F]*")) return true;
    if (parts.length > 4) return false;
    for (int index = 0; index < parts.length; index++) {
      String digits = parts[index];
      if (digits.isEmpty()) return false;
      int radix = 10;
      if (digits.matches("0[xX].*")) {
        digits = digits.substring(2);
        radix = 16;
      } else if (digits.length() > 1 && digits.startsWith("0")) {
        digits = digits.substring(1);
        radix = 8;
      }
      String pattern =
          switch (radix) {
            case 16 -> "[0-9a-fA-F]*";
            case 8 -> "[0-7]*";
            default -> "[0-9]*";
          };
      if (!digits.matches(pattern)) return false;
      try {
        long number = digits.isEmpty() ? 0 : Long.parseLong(digits, radix);
        long limit = index < parts.length - 1 ? 256 : 1L << (8 * (5 - parts.length));
        if (number >= limit) return false;
      } catch (NumberFormatException error) {
        return false;
      }
    }
    return true;
  }

  private String name(String input) {
    String value = input.strip();
    ApiException.require(
        !value.isBlank() && value.codePoints().noneMatch(Character::isISOControl),
        "이름을 줄바꿈 없이 입력하세요.");
    return value;
  }
}
